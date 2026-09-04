import { AiError } from './ai.mjs'
import { findMatchingArticleUrl } from './article.mjs'

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc'
const CACHE_MS = 15 * 60 * 1000
const cache = new Map()
const DIRECT_AI_FEEDS = [
  ['MIT News AI', 'https://news.mit.edu/rss/topic/artificial-intelligence2'],
  ['TechCrunch AI', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['Hugging Face', 'https://huggingface.co/blog/feed.xml'],
  ['Ars Technica AI', 'https://arstechnica.com/tag/artificial-intelligence/feed/'],
  ['Microsoft Research', 'https://www.microsoft.com/en-us/research/feed/'],
  ['Nature Machine Intelligence', 'https://www.nature.com/natmachintell.rss'],
  ['NVIDIA Blog', 'https://blogs.nvidia.com/feed/'],
  ['VentureBeat AI', 'https://venturebeat.com/category/ai/feed/'],
]

const compactQuery = (input) => {
  const words = String(input ?? '').toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []
  const ignored = new Set(['what', 'when', 'where', 'which', 'about', 'tell', 'more', 'latest', 'recent', 'news', 'does', 'have', 'with', 'from', 'this', 'that', 'your', 'into', 'would', 'could', 'should'])
  return [...new Set(words.filter((word) => !ignored.has(word)))].slice(0, 6).join(' ')
}

const validPublicUrl = (value) => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '' } catch { return '' }
}
const aggregatorUrl = (value) => {
  try { return /(?:^|\.)(?:news\.google\.com|bing\.com)$/i.test(new URL(value).hostname) } catch { return true }
}
export const isDirectPublisherUrl = (value) => Boolean(validPublicUrl(value)) && !aggregatorUrl(value)
const recentEnough = (value) => {
  const timestamp = new Date(value).getTime()
  return !Number.isFinite(timestamp) || timestamp >= Date.now() - 31 * 24 * 60 * 60 * 1000
}

const decodeXml = (value = '') => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).trim()
const tag = (xml, name) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '')
const plainText = (value) => decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/&#\d+;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 1_500)

async function fetchRss(url, sourceName) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Contexta/0.1 news research prototype' }, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`${sourceName} returned ${response.status}`)
  const xml = await response.text()
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1]
    const publisherHome = validPublicUrl(decodeXml(item.match(/<source\b[^>]*\burl=["']([^"']+)["'][^>]*>/i)?.[1] ?? ''))
    const indexedUrl = validPublicUrl(tag(item, 'link'))
    const sourceUrl = (() => {
      if (!indexedUrl) return ''
      try {
        const parsed = new URL(indexedUrl)
        const publisherUrl = parsed.hostname.endsWith('bing.com') ? validPublicUrl(parsed.searchParams.get('url')) : ''
        return publisherUrl || indexedUrl
      } catch { return indexedUrl }
    })()
    return sourceUrl ? { title: tag(item, 'title'), sourceUrl, publisherHome, domain: (() => { try { return new URL(sourceUrl).hostname.replace(/^www\./, '') } catch { return sourceName } })(), publishedAt: tag(item, 'pubDate'), sourceCountry: 'Global', language: 'English', image: '', summary: plainText(tag(item, 'description')) } : null
  }).filter(Boolean)
}

async function fetchGdelt(query, maxRecords) {
  const url = new URL(GDELT_URL)
  url.searchParams.set('query', query)
  url.searchParams.set('mode', 'artlist')
  url.searchParams.set('format', 'json')
  url.searchParams.set('timespan', '30d')
  url.searchParams.set('sort', 'datedesc')
  url.searchParams.set('maxrecords', String(Math.min(Math.max(maxRecords, 1), 100)))
  const response = await fetch(url, { headers: { 'User-Agent': 'Contexta/0.1 news research prototype' }, signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`GDELT returned ${response.status}`)
  const data = await response.json()
  return (Array.isArray(data?.articles) ? data.articles : []).map((article) => ({ title: String(article.title ?? ''), sourceUrl: validPublicUrl(article.url), domain: String(article.domain || ''), publishedAt: String(article.seendate || ''), sourceCountry: String(article.sourcecountry || 'Global'), language: String(article.language || ''), image: validPublicUrl(article.socialimage), summary: '' })).filter((item) => item.sourceUrl && item.title)
}

export async function searchNews(rawQuery = '', maxRecords = 50) {
  const topic = compactQuery(rawQuery)
  const query = topic ? `("artificial intelligence" OR AI) ${topic}` : '("artificial intelligence" OR "generative AI" OR "AI Act" OR "foundation model")'
  const cacheKey = `${query}:${maxRecords}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.items

  const bingTerms = encodeURIComponent(`("artificial intelligence" OR AI) ${topic}`)
  const results = await Promise.allSettled([
    fetchGdelt(query, maxRecords),
    fetchRss(`https://www.bing.com/news/search?q=${bingTerms}&format=rss`, 'Bing News'),
    ...DIRECT_AI_FEEDS.map(([name, url]) => fetchRss(url, name)),
  ])
  const topicTerms = topic.split(' ').filter((term) => term.length >= 4)
  const sourceLists = results.map((result) => result.status === 'fulfilled' ? result.value : [])
  const rawItems = Array.from({ length: Math.max(0, ...sourceLists.map((items) => items.length)) }, (_, index) => sourceLists.map((items) => items[index]).filter(Boolean)).flat()
    .filter((item) => isDirectPublisherUrl(item.sourceUrl) && recentEnough(item.publishedAt))
    .filter((item) => !topicTerms.length || topicTerms.some((term) => `${item.title} ${item.summary}`.toLowerCase().includes(term)))
  if (!rawItems.length) throw new AiError('Live news search could not be reached.', 502)
  const merged = new Map()
  for (const article of rawItems) {
    const sourceUrl = article.sourceUrl
    const key = String(article.title).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 100)
    const existing = merged.get(key)
    if (!existing) { merged.set(key, article); continue }
    const existingIsAggregator = aggregatorUrl(existing.sourceUrl)
    const nextIsPublisher = !aggregatorUrl(article.sourceUrl)
    const preferred = existingIsAggregator && nextIsPublisher ? article : existing
    merged.set(key, {
      ...preferred,
      summary: String(article.summary || '').length > String(existing.summary || '').length ? article.summary : existing.summary,
      image: preferred.image || existing.image || article.image,
    })
  }
  const items = [...merged.values()].filter((article) => isDirectPublisherUrl(article.sourceUrl)).map((article, index) => {
    const sourceUrl = article.sourceUrl
    return {
      id: `gdelt-${Buffer.from(sourceUrl).toString('base64url').slice(0, 18)}-${index}`,
      title: article.title.slice(0, 400),
      sourceUrl,
      domain: String(article.domain || new URL(sourceUrl).hostname).slice(0, 200),
      publishedAt: article.publishedAt,
      sourceCountry: article.sourceCountry.slice(0, 100),
      language: article.language.slice(0, 50),
      image: article.image,
      summary: String(article.summary || '').slice(0, 1_500),
    }
  }).slice(0, maxRecords)
  cache.set(cacheKey, { at: Date.now(), items })
  return items
}

export async function findArticleCandidates(rawTitle, maxRecords = 12) {
  const title = String(rawTitle ?? '').replace(/\s+-\s+[^-]{2,80}$/, '').trim().slice(0, 220)
  if (!title) return []
  const quoted = `"${title.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim()}"`
  const relaxed = [...new Set(title.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])]
    .filter((term) => !['about', 'after', 'article', 'from', 'have', 'named', 'news', 'opinion', 'report', 'says', 'that', 'this', 'were', 'what', 'when', 'where', 'which', 'with', 'will'].includes(term))
    .slice(0, 8)
    .join(' ')
  const results = await Promise.allSettled([
    fetchGdelt(quoted, Math.max(20, maxRecords)),
    fetchRss(`https://www.bing.com/news/search?q=${encodeURIComponent(quoted)}&format=rss`, 'Bing News'),
    fetchRss(`https://www.bing.com/search?q=${encodeURIComponent(`${quoted} article`)}&format=rss`, 'Bing Web'),
    fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(`${quoted} when:30d`)}&hl=en-US&gl=US&ceid=US:en`, 'Google News'),
    ...(relaxed ? [
      fetchRss(`https://www.bing.com/news/search?q=${encodeURIComponent(relaxed)}&format=rss`, 'Bing News'),
      fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(`${relaxed} when:30d`)}&hl=en-US&gl=US&ceid=US:en`, 'Google News'),
    ] : []),
  ])
  const seen = new Set()
  const raw = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((item) => {
      if (!item.sourceUrl || seen.has(item.sourceUrl)) return false
      seen.add(item.sourceUrl)
      const wanted = new Set(title.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
      const found = new Set(String(item.title).toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
      const overlap = wanted.size ? [...wanted].filter((term) => found.has(term)).length / wanted.size : 0
      return overlap >= .45
    })
    .sort((left, right) => Number(aggregatorUrl(left.sourceUrl)) - Number(aggregatorUrl(right.sourceUrl)))
    .slice(0, maxRecords)
  const resolved = await Promise.all(raw.map(async (article) => {
    if (!aggregatorUrl(article.sourceUrl) || !article.publisherHome) return article
    const direct = await findMatchingArticleUrl(article.publisherHome, title)
    return direct ? { ...article, sourceUrl: direct, domain: new URL(direct).hostname.replace(/^www\./, '') } : article
  }))
  return resolved.filter((article) => isDirectPublisherUrl(article.sourceUrl))
    .map((article, index) => ({
      id: `article-${Buffer.from(article.sourceUrl).toString('base64url').slice(0, 18)}-${index}`,
      ...article,
      title: String(article.title).slice(0, 400),
      summary: String(article.summary || '').slice(0, 1_500),
    }))
}

export async function currentLandmarkDigest() {
  const items = await searchNews('regulation safety governance major model release incident', 20)
  return items.slice(0, 12).map((item) => `${item.publishedAt || 'recent'} — ${item.title} (${item.domain})`).join('\n')
}
