const categories = [
  'models-capabilities',
  'infrastructure',
  'deployment',
  'governance',
  'business-labor',
  'culture-society',
  'science-health',
  'security',
  'uncategorized',
]

const temperatures = ['hot', 'warm', 'cool']
const annotationCache = new Map()
const itemAnnotationCache = new Map()

const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const cleanList = (value, count = 6) => Array.isArray(value) ? [...new Set(value.map((item) => clean(item)).filter(Boolean))].slice(0, count) : []
const cacheKey = (items) => items.map((item) => `${item.id}:${item.title}`).join('|')
const itemKey = (item) => `${item.id}:${item.title}`

const emptyAnnotation = {
  primaryCategory: 'uncategorized', tags: [], actors: [], technologies: [], domains: [], affectedGroups: [], policyIssues: [], concerns: [],
  tension: '', temperature: 'cool', headlineSpans: [], confidence: 0, method: 'semantic-model-unavailable', eventKey: '', eventLabel: '', rationale: '',
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? text
  const objectCandidate = source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1)
  const arrayCandidate = source.slice(source.indexOf('['), source.lastIndexOf(']') + 1)
  try {
    const parsed = JSON.parse(objectCandidate)
    if (Array.isArray(parsed?.items)) return parsed.items
  } catch { /* Try a bare array for providers that ignored the wrapper. */ }
  try { return JSON.parse(arrayCandidate) } catch { return [] }
}

function normalizeAnnotation(raw, item) {
  const title = String(item.title ?? '').slice(0, 400)
  const primaryCategory = categories.includes(raw?.category) ? raw.category : 'uncategorized'
  const phrase = clean(raw?.keyPhrase, 90)
  const start = phrase && phrase.toLowerCase() !== 'ai' ? title.toLowerCase().indexOf(phrase.toLowerCase()) : -1
  const headlineSpans = start >= 0 ? [{ start, end: start + phrase.length, kind: 'keyPhrase' }] : []
  const actors = cleanList(raw?.entities, 5)
  const concerns = cleanList(raw?.concerns, 4)
  return {
    primaryCategory,
    tags: concerns.slice(0, 4),
    actors,
    technologies: cleanList(raw?.technologies, 4),
    domains: cleanList(raw?.domains, 4),
    affectedGroups: cleanList(raw?.affectedGroups, 4),
    policyIssues: cleanList(raw?.policyIssues, 4),
    concerns,
    tension: clean(raw?.tension, 120),
    temperature: temperatures.includes(raw?.temperature) ? raw.temperature : 'cool',
    headlineSpans,
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0)),
    method: 'qwen-semantic-annotation-2',
    eventKey: clean(raw?.eventKey, 90).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    eventLabel: clean(raw?.eventLabel, 100),
    rationale: clean(raw?.rationale, 240),
  }
}

async function annotateBatch(ai, items) {
  const system = `You annotate a rolling news feed for browsing and clustering. This is a semantic task, never keyword matching.

Return ONLY one JSON object: {"items":[...]}. Include one item per input, in the same order. Each item must use this compact schema:
{"i":0,"category":"one allowed value","eventKey":"concrete-event-slug","eventLabel":"short human event label","concerns":["specific concern"],"entities":["named entity"],"technologies":["specific technology"],"domains":["application domain"],"affectedGroups":["group"],"policyIssues":["issue"],"tension":"short tension or empty","temperature":"hot|warm|cool","keyPhrase":"exact title substring or empty","confidence":0.0,"rationale":"brief reason"}

Allowed categories: ${categories.join(', ')}.
Rules:
- Classify by the headline's primary human concern, not by the presence of generic words such as AI, model, new, or says.
- eventKey means the same concrete event/development, not merely the same broad topic. Use an empty string if uncertain.
- keyPhrase is at most one short, exact, continuous title substring carrying the most discriminating information. Never return AI alone. Return empty when no span materially improves comprehension.
- At most one third of the items should receive a keyPhrase. Highlighting is editorial emphasis, not decoration.
- Use hot only for conflict, harm, urgent consequence, or sharp controversy; warm for meaningful movement; cool for neutral or unclear coverage.
- Do not invent facts beyond the supplied title and metadata.`
  const input = items.map((item, i) => ({ i, title: item.title, date: item.publishedAt, domain: item.domain }))
  const result = await ai.chat({ system, user: JSON.stringify(input), temperature: 0, maxTokens: 3200 })
  const parsed = extractJson(result.text)
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Semantic annotation did not match the requested schema.')
  const annotated = items.map((item, index) => {
    const raw = parsed.find((entry) => entry?.i === index) ?? parsed[index]
    return { ...item, annotation: raw ? normalizeAnnotation(raw, item) : { ...emptyAnnotation } }
  })
  const highlightBudget = Math.max(1, Math.floor(items.length * .3))
  const highlighted = annotated.map((item, index) => ({ index, confidence: item.annotation.confidence, hasSpan: item.annotation.headlineSpans.length > 0 })).filter((item) => item.hasSpan).sort((a, b) => b.confidence - a.confidence).slice(0, highlightBudget)
  const keep = new Set(highlighted.map((item) => item.index))
  return annotated.map((item, index) => keep.has(index) ? item : { ...item, annotation: { ...item.annotation, headlineSpans: [] } })
}

export async function annotateNewsWithModel(ai, items) {
  const key = cacheKey(items)
  const cached = annotationCache.get(key)
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.items
  try {
    const now = Date.now()
    const missing = items.filter((item) => {
      const stored = itemAnnotationCache.get(itemKey(item))
      return !stored || now - stored.at >= 24 * 60 * 60_000
    })
    const batches = []
    for (let index = 0; index < missing.length; index += 14) batches.push(missing.slice(index, index + 14))
    const fresh = (await Promise.all(batches.map(async (batch) => {
      try { return await annotateBatch(ai, batch) }
      catch { return batch.map((item) => ({ ...item, annotation: { ...emptyAnnotation } })) }
    }))).flat()
    for (const item of fresh) if (item.annotation.method !== 'semantic-model-unavailable') itemAnnotationCache.set(itemKey(item), { at: now, annotation: item.annotation })
    const freshByKey = new Map(fresh.map((item) => [itemKey(item), item.annotation]))
    const annotated = items.map((item) => ({ ...item, annotation: freshByKey.get(itemKey(item)) ?? itemAnnotationCache.get(itemKey(item))?.annotation ?? { ...emptyAnnotation } }))
    annotationCache.set(key, { at: Date.now(), items: annotated })
    if (annotationCache.size > 8) annotationCache.delete(annotationCache.keys().next().value)
    if (itemAnnotationCache.size > 1_000) for (const oldKey of [...itemAnnotationCache.keys()].slice(0, itemAnnotationCache.size - 800)) itemAnnotationCache.delete(oldKey)
    return annotated
  } catch {
    // A failed model annotation should be visibly absent, never replaced by a token heuristic.
    return items.map((item) => ({ ...item, annotation: { ...emptyAnnotation } }))
  }
}

const tokens = (value) => new Set(String(value).toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
const overlap = (a, b) => [...a].filter((value) => b.has(value)).length
const daysBetween = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000

export function clusterNews(items) {
  const clusters = []
  for (const raw of items) {
    const titleTokens = tokens(raw.title)
    const eventKey = raw.annotation?.eventKey
    const existing = clusters.find((cluster) =>
      (eventKey && cluster.eventKey === eventKey && daysBetween(raw.publishedAt, cluster.item.publishedAt) <= 14) ||
      (overlap(titleTokens, cluster.tokens) >= 4 && daysBetween(raw.publishedAt, cluster.item.publishedAt) <= 14))
    if (existing) { existing.coverage.push(raw); for (const token of titleTokens) existing.tokens.add(token) }
    else clusters.push({ item: raw, eventKey, tokens: titleTokens, coverage: [raw] })
  }
  return clusters.map(({ item, coverage }) => ({ ...item, id: `dev-${item.id}`, coverage, sourceCount: coverage.length, coverageSignal: coverage.length >= 5 ? 'exploding' : coverage.length >= 3 ? 'emerging' : 'quiet' }))
}

export function validateAnnotation(annotation, title) {
  const validKinds = new Set(['keyPhrase'])
  return Boolean(annotation && categories.includes(annotation.primaryCategory) && temperatures.includes(annotation.temperature) && Array.isArray(annotation.headlineSpans) && annotation.headlineSpans.every((span) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end <= title.length && span.end > span.start && validKinds.has(span.kind)))
}
