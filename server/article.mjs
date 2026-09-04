import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const ARTICLE_CACHE_MS = 30 * 60 * 1000
const articleCache = new Map()
const articleUrlCache = new Map()

const normalizedHostname = (hostname) => hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
const blockedHostname = (hostname) => {
  const value = normalizedHostname(hostname)
  return value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal') || value === 'home.arpa' || value.endsWith('.home.arpa')
}

export function isPublicIp(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && ((b === 0 && c === 0) || (b === 0 && c === 2) || b === 168)) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (net.isIPv6(address)) return /^[23]/i.test(address)
  return false
}

async function safeHttpUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || blockedHostname(url.hostname)) throw new Error('Unsafe article URL.')
  const hostname = normalizedHostname(url.hostname)
  const literalFamily = net.isIP(hostname)
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await dns.lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error('Private or special-use article address.')
  return { url, target: addresses[0] }
}

async function requestText(prepared, { maxBytes, timeoutMs, userAgent }) {
  return new Promise((resolve, reject) => {
    const transport = prepared.url.protocol === 'https:' ? https : http
    const request = transport.request(prepared.url, {
      method: 'GET',
      headers: { 'User-Agent': userAgent, Accept: 'text/html,text/plain;q=0.8' },
      lookup: (_hostname, _options, callback) => callback(null, prepared.target.address, prepared.target.family),
    }, (response) => {
      const chunks = []
      let size = 0
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') })
      }
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) { response.destroy(); finish(); return }
        chunks.push(chunk)
      })
      response.on('end', finish)
      response.on('error', (error) => { if (!settled) reject(error) })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Article request timed out.')))
    request.on('error', reject)
    request.end()
  })
}

const decodeHtml = (value) => value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
const cleanFragment = (value) => decodeHtml(value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

const titleTokens = (value) => new Set(String(value).toLowerCase().match(/[a-z0-9]{4,}/g)?.filter((token) => !['nature', 'news', 'article', 'opinion', 'about', 'from', 'with'].includes(token)) ?? [])

export async function findMatchingArticleUrl(publisherHome, expectedTitle = '') {
  const cacheKey = `${publisherHome}\n${expectedTitle}`
  const cached = articleUrlCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ARTICLE_CACHE_MS) return cached.url
  try {
    let page = await safeHttpUrl(publisherHome)
    for (let redirect = 0; redirect <= 2; redirect += 1) {
      const response = await requestText(page, { maxBytes: 650_000, timeoutMs: 8_000, userAgent: 'Contexta/0.1 article resolver' })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location
        if (!location || redirect === 2) return ''
        page = await safeHttpUrl(new URL(location, page.url).toString())
        continue
      }
      if (response.status < 200 || response.status >= 300 || !/^text\/html/i.test(response.headers['content-type'] ?? '')) return ''
      const html = response.text
      const expected = titleTokens(expectedTitle)
      let best = { score: 0, url: '' }
      for (const match of html.matchAll(/<a\b([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
        const label = cleanFragment(match[3])
        const candidateTerms = titleTokens(`${label} ${match[1]}`)
        const score = expected.size ? [...expected].filter((token) => candidateTerms.has(token)).length / expected.size : 0
        if (score < .55 || score <= best.score) continue
        try {
          const candidate = await safeHttpUrl(new URL(decodeHtml(match[2]), page.url).toString())
          if (candidate.url.hostname !== page.url.hostname && !candidate.url.hostname.endsWith(`.${page.url.hostname}`) && !page.url.hostname.endsWith(`.${candidate.url.hostname}`)) continue
          best = { score, url: candidate.url.toString() }
        } catch { /* Ignore unsafe or malformed homepage links. */ }
      }
      articleUrlCache.set(cacheKey, { at: Date.now(), url: best.url })
      if (articleUrlCache.size > 300) articleUrlCache.delete(articleUrlCache.keys().next().value)
      return best.url
    }
    return ''
  } catch { return '' }
}

export function readableExcerpt(html, expectedTitle = '') {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|svg|nav|header|footer|form|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  if (expectedTitle) {
    const expected = titleTokens(expectedTitle)
    const documentTitle = titleTokens(cleanFragment(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''))
    const shared = [...expected].filter((token) => documentTitle.has(token)).length
    if (expected.size >= 2 && shared < Math.min(2, expected.size)) return ''
  }
  const article = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? cleaned
  const paragraphs = [...article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => cleanFragment(match[1])).filter((text) => text.length >= 70)
  const text = (paragraphs.length >= 2 ? paragraphs.join('\n') : cleanFragment(article)).slice(0, 12_000)
  return text.length >= 240 ? text : ''
}

export async function fetchArticleExcerpt(sourceUrl, expectedTitle = '') {
  const cacheKey = `${sourceUrl}\n${expectedTitle}`
  const cached = articleCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ARTICLE_CACHE_MS) return cached.text
  try {
    let page = await safeHttpUrl(sourceUrl)
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await requestText(page, { maxBytes: 260_000, timeoutMs: 9_000, userAgent: 'Contexta/0.1 research summarizer' })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location
        if (!location || redirect === 3) return ''
        page = await safeHttpUrl(new URL(location, page.url).toString())
        continue
      }
      if (response.status < 200 || response.status >= 300 || !/^text\/(?:html|plain)/i.test(response.headers['content-type'] ?? '')) return ''
      const text = readableExcerpt(response.text, expectedTitle)
      articleCache.set(cacheKey, { at: Date.now(), text })
      if (articleCache.size > 300) articleCache.delete(articleCache.keys().next().value)
      return text
    }
    return ''
  } catch { return '' }
}
