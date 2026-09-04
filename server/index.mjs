import http from 'node:http'
import net from 'node:net'
import { loadConfig } from './config.mjs'
import { createAiClient, AiError } from './ai.mjs'
import { askPrompt, personaPrompt, reportPrompt, PROMPT_VERSION } from './prompts.mjs'
import { currentLandmarkDigest, findArticleCandidates, searchNews } from './news.mjs'
import { annotateNewsWithModel, clusterNews, validateAnnotation } from './semantic.mjs'
import { applyPersonaSurfaceStyle, cleanRecentMessages, formatRecentMessages, isMissedSocialRepair, isRepeatedReply, isSocialRepairMessage, personaFailureFallback, personaRepairFallback, stableBucket, stripConversationEcho } from './persona-routing.mjs'
import { fetchArticleExcerpt } from './article.mjs'
import { createSessionManager, MemoryRateLimiter, securityHeaders, verifyTurnstileToken } from './security.mjs'
import { serveStatic } from './static.mjs'

const config = loadConfig()
const ai = createAiClient(config)
const sessions = config.auth.required ? createSessionManager({ secret: config.auth.sessionSecret, ttlMinutes: config.auth.sessionTtlMinutes, secure: config.production }) : null
const aiLimiter = new MemoryRateLimiter({ perMinute: config.requestsPerMinute, perDay: config.requestsPerDay, label: 'Contexta AI' })
const externalLimiter = new MemoryRateLimiter({ perMinute: config.externalRequestsPerMinute, perDay: config.externalRequestsPerDay, label: 'Contexta external' })

const send = (res, status, data, extraHeaders = {}) => {
  res.writeHead(status, { ...securityHeaders({ production: config.production }), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders })
  res.end(JSON.stringify(data))
}

const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const cleanStringList = (value, count = 12, size = 100) => Array.isArray(value) ? value.slice(0, count).map((item) => cleanText(item, size)).filter(Boolean) : []
function cleanEvidence(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).map((item, index) => ({
    id: cleanText(item?.id, 80) || `item-${index + 1}`,
    title: cleanText(item?.title, 300),
    summary: cleanText(item?.summary, 2_000),
    summaryKind: item?.summaryKind === 'publisher-feed' ? 'publisher-feed' : 'derived-metadata',
    period: cleanText(item?.period, 100),
    region: cleanText(item?.region, 100),
    sourceUrl: cleanText(item?.sourceUrl, 1_000),
  })).filter((item) => item.title && item.summary)
}

const evidenceBlock = (items) => items.map((item) => `[EVIDENCE ${item.id}]\nTitle: ${item.title}\nPeriod: ${item.period}\nRegion: ${item.region}\nContext type: ${item.summaryKind === 'publisher-feed' ? 'publisher-provided feed text' : 'derived index metadata'}\nSummary: ${item.summary}\nURL: ${item.sourceUrl}`).join('\n\n')

const newsAsEvidence = (items) => items.map((item) => ({ id: item.id, title: item.title, summary: item.summary || `The live index provides this headline from ${item.domain}, but no article excerpt.`, period: item.publishedAt, region: item.sourceCountry, sourceUrl: item.sourceUrl }))
const isAggregatorUrl = (value) => { try { return /(?:^|\.)(?:news\.google\.com|bing\.com)$/i.test(new URL(value).hostname) } catch { return true } }
const sourceDomain = (value) => { try { return new URL(value).hostname.replace(/^www\./, '') } catch { return 'unknown source' } }
const titleTerms = (value) => new Set((String(value).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((term) => !['about', 'after', 'article', 'from', 'have', 'news', 'opinion', 'report', 'says', 'that', 'this', 'were', 'what', 'when', 'where', 'which', 'with', 'will'].includes(term)))
const titleOverlap = (left, right) => {
  const a = titleTerms(left); const b = titleTerms(right)
  return a.size && b.size ? [...a].filter((term) => b.has(term)).length / Math.min(a.size, b.size) : 0
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new AiError('Request body is too large.', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AiError('Request body must be valid JSON.', 400) }
}

function clientIdentity(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    if (net.isIP(forwarded)) return forwarded
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function enforce(limiter, req) {
  const result = limiter.check(clientIdentity(req))
  if (!result.allowed) throw new AiError(result.message, 429)
}

function requireDemoAuth(req) {
  if (config.auth.required && !sessions?.authenticated(req)) throw new AiError('Complete the browser verification to use live AI.', 401)
}

async function route(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost')
  if (req.method === 'GET' && requestUrl.pathname === '/api/auth/session') {
    return send(res, 200, { required: config.auth.required, authenticated: !config.auth.required || sessions?.authenticated(req) === true, siteKey: config.auth.required ? config.auth.siteKey : '' })
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/auth/turnstile') {
    if (!config.auth.required) return send(res, 204, {})
    enforce(externalLimiter, req)
    const body = await readJson(req)
    const verified = await verifyTurnstileToken({ token: cleanText(body.token, 2_048), secretKey: config.auth.secretKey, allowedHostnames: config.auth.allowedHostnames })
    if (!verified) throw new AiError('Browser verification failed or expired. Please retry.', 401)
    return send(res, 204, {}, { 'Set-Cookie': sessions.createCookie() })
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/ai/health') {
    return send(res, 200, { configured: true, provider: config.provider, model: config.generationModel, demoMode: config.demoMode, promptVersion: PROMPT_VERSION })
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/news') {
    enforce(externalLimiter, req)
    const items = await searchNews(requestUrl.searchParams.get('q') ?? '', 60)
    return send(res, 200, { items, windowDays: 30, refreshedAt: new Date().toISOString() })
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/developments') {
    requireDemoAuth(req)
    enforce(externalLimiter, req)
    enforce(aiLimiter, req)
    const items = await searchNews(requestUrl.searchParams.get('q') ?? '', 80)
    const annotated = await annotateNewsWithModel(ai, items)
    const developments = clusterNews(annotated).filter((item) => validateAnnotation(item.annotation, item.title))
    return send(res, 200, { developments, windowDays: 30, refreshedAt: new Date().toISOString(), schemaVersion: 2 })
  }
  if (!requestUrl.pathname.startsWith('/api/')) {
    if (await serveStatic(req, res, requestUrl.pathname, { production: config.production })) return
    return send(res, 404, { error: 'Not found.' })
  }
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found.' })
  const isArticleRoute = requestUrl.pathname === '/api/article/access'
  const isAiRoute = ['/api/ai/ask', '/api/ai/persona', '/api/ai/report'].includes(requestUrl.pathname)
  if (!isArticleRoute && !isAiRoute) return send(res, 404, { error: 'Not found.' })
  if (isAiRoute) { requireDemoAuth(req); enforce(aiLimiter, req) }
  enforce(externalLimiter, req)
  const body = await readJson(req)

  if (isArticleRoute) {
    const article = cleanEvidence(body.evidence)[0]
    if (!article?.sourceUrl) return send(res, 200, { accessible: false })
    const excerpt = await fetchArticleExcerpt(article.sourceUrl, article.title)
    return send(res, 200, { accessible: Boolean(excerpt) })
  }

  if (requestUrl.pathname === '/api/ai/ask') {
    const question = cleanText(body.question, 2_000)
    if (!question) throw new AiError('A question is required.', 400)
    const casual = /^(hi|hey|hello|how are you|how is your day|how's your day|thanks|thank you|good (morning|afternoon|evening)|what's up|whats up)[?!. ]*$/i.test(question)
    const suppliedEvidence = cleanEvidence(body.evidence)
    let liveEvidence = []
    let landmarks = ''
    if (!casual) try { [liveEvidence, landmarks] = await Promise.all([searchNews(question, 12).then(newsAsEvidence), currentLandmarkDigest()]) } catch { /* General conversation must still work if research is down. */ }
    const evidence = casual ? [] : [...liveEvidence, ...suppliedEvidence].slice(0, 16)
    const history = Array.isArray(body.history) ? body.history.slice(-10).map((item) => ({ role: item?.role === 'assistant' ? 'assistant' : 'user', content: cleanText(item?.content, 1_500) })).filter((item) => item.content) : []
    const result = await ai.chat({ system: askPrompt(landmarks), history, user: `CURRENT QUESTION:\n${question}\n\nLIVE AND LOCAL EVIDENCE:\n${evidence.length ? evidenceBlock(evidence) : '(none; use stable knowledge or casual conversation, and do not claim live research succeeded)'}`, maxTokens: 1800 })
    const cited = evidence.slice(0, 6)
    const reaction = /\?|wonder|curious/i.test(result.text) ? 'curious' : /worry|harm|risk|concern/i.test(result.text) ? 'concerned' : /doubt|claim|skeptic|really/i.test(result.text) ? 'skeptical' : /wow|surpris/i.test(result.text) ? 'surprised' : 'neutral'
    return send(res, 200, { ...result, reaction, sources: cited.map(({ id, title, sourceUrl }) => ({ id, title, url: sourceUrl })) })
  }

  if (requestUrl.pathname === '/api/ai/persona') {
    const message = cleanText(body.message, 2_000)
    const mode = ['share-briefing', 'share-reaction'].includes(body.mode) ? body.mode : 'chat'
    const directlyAddressed = body.directlyAddressed === true
    const evidence = cleanEvidence(body.evidence)
    const peerMessage = { name: cleanText(body.peerMessage?.name, 80), text: cleanText(body.peerMessage?.text, 600) }
    const persona = { kind: body.persona?.kind === 'bot' ? 'bot' : 'person', name: cleanText(body.persona?.name, 80), handle: cleanText(body.persona?.handle, 80), role: cleanText(body.persona?.role, 160), bio: cleanText(body.persona?.bio, 500), voice: cleanText(body.persona?.voice, 300), concerns: cleanStringList(body.persona?.concerns), attention: cleanStringList(body.persona?.attention), beliefs: cleanStringList(body.persona?.beliefs), lifeDetails: cleanStringList(body.persona?.lifeDetails), anchorMemory: cleanText(body.persona?.anchorMemory, 800), blindSpot: cleanText(body.persona?.blindSpot, 500), verbalTics: cleanStringList(body.persona?.verbalTics, 5, 180), disagreementStyle: cleanText(body.persona?.disagreementStyle, 300), relationships: cleanText(JSON.stringify(body.persona?.relationships ?? {}), 1_500) }
    if (!message || !persona.name) throw new AiError('A message and persona are required.', 400)
    const recentMessages = cleanRecentMessages(body.recentMessages, 20)
    const recentTexts = recentMessages.map((item) => `${item.author}: ${item.text}`)
    const currentUserTurn = recentMessages.findLast((item) => item.author.toLowerCase() === 'you' && item.text === message) ?? recentMessages.findLast((item) => item.author.toLowerCase() === 'you')
    const threadBeforeCurrent = recentMessages.at(-1)?.author.toLowerCase() === 'you' && recentMessages.at(-1)?.text === message ? recentMessages.slice(0, -1) : recentMessages
    const recent = formatRecentMessages(threadBeforeCurrent)
    const explicitSummary = /\b(?:summari[sz]e|summary|tldr|tl;dr|explain|context|what happened|short version|catch me up)\b/i.test(message)
    const conversationSummary = /\b(?:conversation|convo|chat|thread)\b/i.test(message)
    const premiseCorrection = /\b(?:what demo|that(?:'s| is) an essay|you(?:'re| are) wrong|that(?:'s| is) not what|no[,!.])\b/i.test(message)
    const rejectedDemoInThread = recentMessages.slice(-8).some((item) => /\bwhat demo\b/i.test(item.text))
    const choseNewsAfterClarification = /\b(?:news|story|article|the one i shared)\b/i.test(message) && recentMessages.slice(-3).some((item) => /\b(?:summari[sz]e|summary|news or (?:the )?(?:conversation|convo)|tldr)\b/i.test(item.text))
    const newsSummary = mode === 'share-briefing' || (!conversationSummary && (explicitSummary || choseNewsAfterClarification) && evidence.length > 0)
    const storyContextTurn = newsSummary || mode === 'share-reaction' || /\b(?:article|story|headline|source|link|this news|that news|the one i shared)\b/i.test(message) || /^(?:so,?\s*)?(?:what do you think|thoughts|your take)\b/i.test(message.trim())
    let articleEvidence = []
    let directHasArticleText = false
    if (evidence.length && storyContextTurn) {
      const excerpt = await fetchArticleExcerpt(evidence[0].sourceUrl, evidence[0].title)
      directHasArticleText = Boolean(excerpt)
      articleEvidence = excerpt ? [{ ...evidence[0], summary: `Accessible original article text (read this before responding; it may still omit paywalled or script-rendered sections): ${excerpt}` }] : []
    }
    let researched = []
    let fallbackHasArticleText = false
    const needsStoryResearch = (newsSummary || mode === 'share-reaction') && evidence.length > 0
    const researchQuery = needsStoryResearch ? evidence[0]?.title : message
    if (needsStoryResearch && !directHasArticleText && researchQuery) try {
      const [matchingResult, newsResult] = await Promise.allSettled([findArticleCandidates(researchQuery, 10), searchNews(researchQuery, 10)])
      const matching = matchingResult.status === 'fulfilled' ? matchingResult.value : []
      const news = newsResult.status === 'fulfilled' ? newsResult.value : []
      const otherIndexedCoverage = evidence.slice(1).map((item) => ({ ...item, domain: sourceDomain(item.sourceUrl), publishedAt: item.period, sourceCountry: item.region }))
      const seen = new Set()
      const candidates = [...otherIndexedCoverage, ...matching, ...news]
        .filter((item) => {
          if (!item.sourceUrl || item.sourceUrl === evidence[0]?.sourceUrl || isAggregatorUrl(item.sourceUrl) || seen.has(item.sourceUrl)) return false
          seen.add(item.sourceUrl)
          return titleOverlap(evidence[0]?.title, item.title) >= .25
        })
        .sort((left, right) => titleOverlap(evidence[0]?.title, right.title) - titleOverlap(evidence[0]?.title, left.title))
        .slice(0, 8)
      const excerpts = await Promise.all(candidates.map((item) => fetchArticleExcerpt(item.sourceUrl, item.title)))
      researched = newsAsEvidence(candidates).flatMap((item, index) => excerpts[index] ? [{ ...item, summary: `Publicly readable corroborating article text from ${sourceDomain(item.sourceUrl)} (do not quote at length): ${excerpts[index]}` }] : [])
      fallbackHasArticleText = researched.length > 0
    } catch { /* The explicit access limitation below is safer than inventing context. */ }
    else if (!needsStoryResearch && /https?:\/\/|search|look up|latest|recent|source|what happened|news/i.test(message)) try {
      researched = newsAsEvidence(await searchNews(researchQuery, 8))
    } catch { /* Free conversation remains available. */ }
    const hasArticleText = directHasArticleText || fallbackHasArticleText
    const publisherSummary = evidence.find((item) => item.summaryKind === 'publisher-feed' && item.summary.length >= 100)?.summary ?? ''
    const hasPublisherSummary = Boolean(publisherSummary)
    const hasReadableSourceContext = hasArticleText || hasPublisherSummary
    const suppliedOnlyWrappers = evidence.length > 0 && evidence.every((item) => isAggregatorUrl(item.sourceUrl))
    const accessFailure = suppliedOnlyWrappers
      ? 'The feed supplied an aggregator wrapper instead of a readable publisher page, and the direct article could not be recovered.'
      : 'The publisher did not return readable article text to automated access. The page may be paywalled, bot-protected, or rendered only by browser JavaScript.'
    const fallbackSourceNames = [...new Set(researched.map((item) => sourceDomain(item.sourceUrl)))].slice(0, 4)
    const fallbackDisclosure = fallbackHasArticleText ? `I could not access the original article at ${sourceDomain(evidence[0]?.sourceUrl)}. I searched for independent, publicly readable coverage and based this briefing on ${fallbackSourceNames.join(', ')}; those sources are linked below.` : ''
    const grounded = storyContextTurn ? [...articleEvidence, ...researched, ...evidence].slice(0, 10) : researched.slice(0, 10)
    const expressionBucket = stableBucket(`${persona.name}:${message}:${recent}`, 8)
    const expressionBudget = `Speech-habit callback: ${expressionBucket < 2 ? 'one is allowed if it fits naturally' : 'dormant for this reply; do not use a listed catchphrase'}. Direct anchor-memory or relationship callback: ${expressionBucket === 0 ? 'allowed only if unusually relevant' : 'dormant for this reply; let it shape attention without mentioning it'}.`
    const socialRepair = isSocialRepairMessage(message)
    const roomCall = /^(?:hey\s+)?(?:guys|everyone|yall|y'all|people|hello|hi)[!?.\s]*$/i.test(message)
    const howToTurn = /\b(?:how (?:would|do|can|should)|what (?:would|should) (?:i|we)|help me (?:make|build|design|use|write|fix))\b/i.test(message)
    const socialRoute = socialRepair ? '\nThis is a social-repair move about your tone, silence, or behavior. Acknowledge that specific moment, tease back, or own it naturally. Do not resume the article or give a factual summary.' : ''
    const roomCallRoute = roomCall ? '\nThe user is only getting the room\'s attention. Answer like a person who just looked up (for example, a brief acknowledgement or question). Do not start analyzing the attached article until the user says what they want.' : ''
    const correctionRoute = premiseCorrection ? '\nThe user is correcting a mistaken premise. Briefly own the specific mistake and update your understanding. Do not defend, rename, metaphorically reinterpret, or ask a question that preserves the rejected premise.' : ''
    const directHelpRoute = mode === 'chat' && directlyAddressed && !newsSummary && !socialRepair && !roomCall && !premiseCorrection ? `\nAnswer the latest request directly. It may be about design, games, coffee, work, feelings, or anything else, and does not need to concern AI news. Use stable general knowledge when helpful. Ignore the attached story unless the latest message actually refers to it.${/\bvibe cod(?:e|ing)\b/i.test(message) ? ' Here, vibe coding means iteratively building software with an AI coding model: describe a small behavior, run the result, inspect it in the browser, then refine or repair it. It does not mean choosing a visual mood.' : ''}${howToTurn ? ' This is a practical how-to request. Temporarily suppress your blind spot, catchphrases, and impulse to challenge the premise. Begin with a sincere, functional method the user could actually try today, then give at least two concrete steps. Do not propose intentionally useless design as a joke. Banter may come only after the useful answer.' : ' Give at least one usable answer before a critique or question.'}` : ''
    const ambientRoute = mode === 'chat' && message.split(/\s+/).length <= 8 && !explicitSummary ? '\nA short social or ambient response is allowed. Banter, a quick reaction, or a small acknowledgment can be the whole message. Do not manufacture a thesis or force your professional specialty into it.' : ''
    const styleRoute = persona.name.toLowerCase() === 'mika' ? '\nWrite every visible word in lowercase. Stay casual.' : persona.name.toLowerCase() === 'ren' ? '\nLead with the direct answer. Keep it tight and concrete.' : persona.name.toLowerCase() === 'sora' ? '\nUse polished grammar and normal capitalization. You may banter freely, but answer a direct question before reframing it.' : persona.name.toLowerCase() === 'jules' ? `\nUse an emoji only when it feels conversational. ${expressionBucket === 1 ? 'A single harmless casual typo is allowed this turn.' : 'Do not force a typo this turn.'}` : '\nBe literal and structured enough to fact-check; do not imitate the human members.'
    const summaryRoute = newsSummary && mode !== 'share-briefing' ? '\nThe user wants the shared news summarized. Start by plainly stating what happened and why it matters in two to four sentences. Use only the indexed headline, excerpts, and coverage supplied below. Treat claims from the chat as unverified conversation, not article contents. Do not ask whether they mean the news or conversation. If the excerpts are insufficient, state that limitation after giving the useful headline-level answer; never invent article details.' : ''
    const shareBriefingRoute = mode === 'share-briefing' ? directHasArticleText ? '\nYou are opening the thread. Give a detailed but readable briefing: what the accessible original article text reports or argues, the background needed to understand it, why it matters, and the most important uncertainty or limitation. Use five to eight sentences. Do not ask the user to clarify which story; exactly one shared story is attached.' : fallbackHasArticleText ? `\nYou are opening the thread after the original publisher page could not be read. Begin with this exact disclosure, without softening or omitting it: “${fallbackDisclosure}” Then give a detailed, readable briefing using only the publicly readable corroborating articles below: what they report, the background needed to understand it, why it matters, and material differences or uncertainty. Use five to eight sentences after the disclosure. Never imply these sources are the original article or attribute their claims to the inaccessible original.` : hasPublisherSummary ? `\nThe publisher page could not be fully read. Say that plainly, then explain what the publisher-provided RSS text does establish, add stable background, and distinguish it from anything the unavailable full article might contain. Do not say you read the full article. Publisher feed text: ${publisherSummary}` : `\nYou are opening the thread, but the actual article text could not be accessed and the web search found no readable substitute. Say this reason plainly in the first sentence: ${accessFailure} Do not call it merely insufficient context and do not imply that you read the page. You may explain stable background from the headline, but do not attribute unsupplied details, arguments, findings, or emphasis to the article. Do not ask which story; exactly one is attached.` : ''
    const shareReactionRoute = mode === 'share-reaction' ? hasArticleText ? '\nYou have read the attached story context and Lil Bot briefing. React as a member of the room in one to three sentences only when the development or latest coworker point genuinely intersects your interests. Add one distinct observation, disagreement, answer, tease, or genuine question. Do not summarize it again or sound like an assistant. If you have nothing distinct to add, write PASS.' : '\nOnly the headline and metadata were accessible. React to the premise or latest coworker point only if you have a distinct reason to speak, and never pretend you read unsupplied findings. Otherwise write PASS.' : ''
    const replyRoute = currentUserTurn?.replyToAuthor && currentUserTurn?.replyToText ? `\nThe user's message is explicitly replying to ${currentUserTurn.replyToAuthor}'s line: “${currentUserTurn.replyToText}”. Resolve words like “this”, “that”, “see?”, and corrections against that quoted line.` : ''
    const peerRoute = peerMessage.name && peerMessage.text ? `\nA coworker just replied after the user: ${peerMessage.name}: “${peerMessage.text}”\nRespond to that coworker's actual move, not merely the original topic. If they asked a question, answer it or meaningfully challenge its premise instead of asking a parallel question. Otherwise agree, challenge, correct, tease, or extend one specific point. If you have no distinct response, PASS. Never fuse their name into their sentence, imitate their wording, or act as though they are the user.` : ''
    const personaInput = `ROUTING:\n${directlyAddressed ? 'The user directly addressed you or continued a conversation with you. Respond to their latest move; PASS is forbidden.' : 'You were not directly addressed. You may PASS if you have no distinct reason to speak.'}${socialRoute}${roomCallRoute}${correctionRoute}${directHelpRoute}${ambientRoute}${summaryRoute}${shareBriefingRoute}${shareReactionRoute}${replyRoute}${peerRoute}${styleRoute}\n${expressionBudget}\n\nWHAT WAS JUST SAID:\n${message}\n\nEARLIER THREAD (chronological; does not repeat the current message):\n${recent || '(new conversation)'}\n\nOPTIONAL ARTICLE AND RESEARCH CONTEXT (ignore it unless the current turn refers to it):\n${grounded.length ? evidenceBlock(grounded) : '(none; answer ordinary conversation from stable knowledge without discussing source access)'}`
    let result = await ai.chat({ system: personaPrompt(persona), user: personaInput, maxTokens: mode === 'share-briefing' ? 720 : 280, temperature: persona.kind === 'bot' ? .35 : .75 })
    result = { ...result, text: stripConversationEcho(result.text, message, recentMessages) }
    const missedDirectCall = directlyAddressed && /^PASS[.!\s]*$/i.test(result.text)
    const missedSocialRepair = socialRepair && isMissedSocialRepair(result.text)
    const repeatedReply = mode === 'chat' && isRepeatedReply(result.text, message, recentTexts)
    const revivesRejectedDemo = mode === 'chat' && rejectedDemoInThread && /\bdemo\b/i.test(result.text) && !/\b(?:not|never|wasn't|isn't|invented|made up|mistake|wrong)\b/i.test(result.text)
    const inventsArticleBody = newsSummary && !hasArticleText && /\b(?:the (?:article|piece|study|report) (?:discusses|highlights|focuses|finds|shows|suggests|argues|examines|explores|emphasizes)|researchers? (?:found|showed|demonstrated))\b/i.test(result.text)
    const hidesAccessLimit = mode === 'share-briefing' && !hasReadableSourceContext && !/\b(?:could not|couldn't|wasn't able to|unable to) (?:access|read)|\bheadline(?: and metadata)? only\b/i.test(result.text)
    const hidesFallbackAttribution = mode === 'share-briefing' && fallbackHasArticleText && (!/\b(?:could not|couldn't|wasn't able to|unable to) (?:access|read)\b/i.test(result.text) || !fallbackSourceNames.some((name) => result.text.toLowerCase().includes(name.toLowerCase())))
    if (missedDirectCall || missedSocialRepair || repeatedReply || revivesRejectedDemo || inventsArticleBody || hidesAccessLimit || hidesFallbackAttribution) {
      const retryInstruction = hidesFallbackAttribution ? `The original article was inaccessible, but web search found readable alternatives. Begin with this exact disclosure: “${fallbackDisclosure}” Then summarize only the supplied alternative coverage and distinguish it from the original.` : inventsArticleBody || hidesAccessLimit ? `The article body was not accessible. Begin with this plain reason: ${accessFailure} Then discuss only headline-level context. Do not attribute details, arguments, findings, or emphasis to the article.` : missedSocialRepair ? 'Specifically acknowledge your silence or tone, own it or tease back, and do not return to the old factual topic.' : revivesRejectedDemo ? 'The user already established that there is no demo: own that mistaken premise explicitly and do not use it as a metaphor or question.' : repeatedReply ? 'Make a genuinely new conversational move. Do not echo the user, copy your earlier wording, or recycle a catchphrase.' : 'The user called or continued with you, so answer their latest move.'
      result = await ai.chat({ system: personaPrompt(persona), user: `${personaInput}\n\nYour first attempt failed the conversation check. ${retryInstruction} Reply naturally now and do not write PASS.`, maxTokens: mode === 'share-briefing' ? 720 : 280, temperature: persona.kind === 'bot' ? .42 : .82 })
      result = { ...result, text: stripConversationEcho(result.text, message, recentMessages) }
    }
    const reaction = /\?|curious|wonder/i.test(result.text) ? 'curious' : /lol|haha|😭|😂/i.test(result.text) ? 'amused' : /worry|harm|risk|bad|concern/i.test(result.text) ? 'concerned' : /doubt|claim|really|sure/i.test(result.text) ? 'skeptical' : 'neutral'
    const cited = mode === 'share-briefing' && fallbackHasArticleText ? researched.slice(0, 4) : []
    const rawPass = /^PASS[.!\s]*$/i.test(result.text)
    const stillRepeated = mode === 'chat' && isRepeatedReply(result.text, message, recentTexts)
    const stillRevivesRejectedDemo = mode === 'chat' && rejectedDemoInThread && /\bdemo\b/i.test(result.text) && !/\b(?:not|never|wasn't|isn't|invented|made up|mistake|wrong)\b/i.test(result.text)
    const stillInventsArticleBody = newsSummary && !hasArticleText && /\b(?:the (?:article|piece|study|report) (?:discusses|highlights|focuses|finds|shows|suggests|argues|examines|explores|emphasizes)|researchers? (?:found|showed|demonstrated))\b/i.test(result.text)
    const stillHidesAccessLimit = mode === 'share-briefing' && !hasReadableSourceContext && !/\b(?:could not|couldn't|wasn't able to|unable to) (?:access|read)|\bheadline(?: and metadata)? only\b/i.test(result.text)
    const stillHidesFallbackAttribution = mode === 'share-briefing' && fallbackHasArticleText && (!/\b(?:could not|couldn't|wasn't able to|unable to) (?:access|read)\b/i.test(result.text) || !fallbackSourceNames.some((name) => result.text.toLowerCase().includes(name.toLowerCase())))
    const unusable = rawPass || stillRepeated || stillRevivesRejectedDemo || stillInventsArticleBody || stillHidesAccessLimit
    const pass = !directlyAddressed && unusable
    const correctionFallback = rejectedDemoInThread ? 'yeah, you\'re right. the “demo” was never in the article; i carried an invented premise forward.' : ''
    const sourceFallback = mode === 'share-briefing' && !hasArticleText ? hasPublisherSummary ? `I could not read the full article page for “${evidence[0]?.title || 'this story'}”, but the publisher's own feed supplied this context: ${publisherSummary} That is enough to explain the reported premise, not to claim I verified the unavailable full article.` : `I could not read the full article text for “${evidence[0]?.title || 'this story'}”. ${accessFailure} I only have the headline and feed metadata, so I cannot honestly summarize the article's specific argument, evidence, or findings.` : ''
    const attributedText = stillHidesFallbackAttribution ? `${fallbackDisclosure}\n\n${result.text}` : result.text
    const briefingFailureFallback = mode === 'share-briefing' && unusable
      ? fallbackHasArticleText
        ? `${fallbackDisclosure}\n\nI found readable alternative coverage, but the summary generation failed. Open the sources below or share the story again; I will not invent a briefing from an empty response.`
        : directHasArticleText
          ? `I could access the original article for “${evidence[0]?.title || 'this story'}”, but the summary generation failed. Please share it again; I will not replace it with a guessed summary.`
          : sourceFallback
      : ''
    const rawText = briefingFailureFallback || (directlyAddressed && unusable ? (sourceFallback || correctionFallback || (socialRepair ? personaRepairFallback(persona.name) : personaFailureFallback(persona.name))) : pass ? '' : attributedText)
    const text = applyPersonaSurfaceStyle(persona.name, rawText, expressionBucket)
    const sourceAccess = directHasArticleText ? 'original' : fallbackHasArticleText ? 'fallback-search' : hasPublisherSummary ? 'publisher-feed' : 'headline-only'
    const briefingReady = mode !== 'share-briefing' || (!unusable && sourceAccess !== 'headline-only')
    return send(res, 200, { ...result, text, pass, reaction, sourceAccess, briefingReady, sources: cited.map(({ id, title, sourceUrl }) => ({ id, title, url: sourceUrl })) })
  }

  if (requestUrl.pathname === '/api/ai/report') {
    const topic = cleanText(body.topic, 300)
    const brief = cleanText(body.brief, 2_000)
    const evidence = cleanEvidence(body.evidence)
    const helpers = cleanStringList(body.helpers, 6, 80)
    if (!topic || !evidence.length) throw new AiError('A topic and selected evidence are required.', 400)
    let landmarks = ''
    let liveEvidence = []
    try { [landmarks, liveEvidence] = await Promise.all([currentLandmarkDigest(), searchNews(topic, 20).then(newsAsEvidence)]) } catch { /* Selected evidence remains usable. */ }
    const reportEvidence = [...evidence, ...liveEvidence].slice(0, 24)
    const result = await ai.chat({ system: reportPrompt(landmarks), user: `TOPIC:\n${topic}\n\nUSER BRIEF:\n${brief || 'Identify the most useful connections.'}\n\nSYNTHETIC LENSES REQUESTED:\n${helpers.join(', ') || 'none'}\n\nUSER-SELECTED AND LIVE RESEARCH EVIDENCE:\n${evidenceBlock(reportEvidence)}`, maxTokens: config.reportMaxOutputTokens })
    return send(res, 200, { ...result, researchSourceCount: reportEvidence.length })
  }

  return send(res, 404, { error: 'Not found.' })
}

const server = http.createServer((req, res) => route(req, res).catch((error) => {
  const status = error instanceof AiError ? error.status : 500
  if (!(error instanceof AiError)) console.error('Unhandled AI server error:', error?.message ?? 'unknown error')
  send(res, status, { error: error instanceof AiError ? error.message : 'Internal server error.' })
}))

const host = config.production ? '0.0.0.0' : '127.0.0.1'
server.listen(config.port, host, () => {
  console.log(`Contexta server listening on http://${host}:${config.port} (${config.generationModel})`)
})
