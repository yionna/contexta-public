import type { Persona, Story } from '../data'

export type AiMetadata = { model: string; promptVersion: string; usage?: Record<string, number> | null }
export type SourceAccess = 'original' | 'fallback-search' | 'publisher-feed' | 'headline-only'
type AiResult = AiMetadata & { text: string; reaction?: string; sourceAccess?: SourceAccess; briefingReady?: boolean; sources?: { id: string; title: string; url: string }[] }

const evidenceFor = (items: Story[]) => items.flatMap((story) => {
  const sources = story.sources.slice(0, 3)
  return (sources.length ? sources : [{ url: '' }]).map((source, index) => ({
    id: sources.length > 1 ? `${story.id}-source-${index + 1}` : story.id,
    title: story.title,
    summary: story.sourceSummary || story.post.join(' '),
    summaryKind: story.sourceSummary ? 'publisher-feed' : 'derived-metadata',
    period: story.period,
    region: story.region,
    sourceUrl: source.url,
  }))
})

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error || 'The live AI service is unavailable.')
  return data as T
}

export type ConversationTurn = { role: 'user' | 'assistant'; content: string }
export type PersonaThreadMessage = { author: string; text: string; personaId?: string; replyToAuthor?: string; replyToText?: string }
export type PersonaMode = 'chat' | 'share-briefing' | 'share-reaction'
export type LiveNewsItem = { id: string; title: string; sourceUrl: string; domain: string; publishedAt: string; sourceCountry: string; language: string; image?: string; summary?: string }
export type DevelopmentItem = LiveNewsItem & { coverage: LiveNewsItem[]; sourceCount: number; coverageSignal: string; annotation: NonNullable<Story['annotation']> }

export const askAi = (question: string, evidence: Story[], history: ConversationTurn[]) => post<AiResult>('/api/ai/ask', { question, evidence: evidenceFor(evidence), history })

export async function fetchLiveNews(query = '') {
  const response = await fetch(`/api/news${query ? `?q=${encodeURIComponent(query)}` : ''}`)
  const data = await response.json().catch(() => ({})) as { items?: LiveNewsItem[]; refreshedAt?: string; error?: string }
  if (!response.ok || !data.items) throw new Error(data.error || 'The live 30-day newswire is unavailable.')
  return { items: data.items, refreshedAt: data.refreshedAt ?? new Date().toISOString() }
}
export async function fetchDevelopments(query = '') {
  const response = await fetch(`/api/developments${query ? `?q=${encodeURIComponent(query)}` : ''}`)
  const data = await response.json().catch(() => ({})) as { developments?: DevelopmentItem[]; refreshedAt?: string; error?: string }
  if (!response.ok || !data.developments) throw new Error(data.error || 'The development map is unavailable.')
  return { items: data.developments, refreshedAt: data.refreshedAt ?? new Date().toISOString() }
}

export const checkArticleAccess = (story: Story, signal?: AbortSignal) =>
  post<{ accessible: boolean }>('/api/article/access', { evidence: evidenceFor([story]) }, signal)

export const askPersona = (message: string, persona: Persona, story: Story | undefined, recentMessages: PersonaThreadMessage[], directlyAddressed = false, peerMessage?: { name: string; text: string }, mode: PersonaMode = 'chat', signal?: AbortSignal) =>
  post<AiResult & { pass: boolean; reaction: 'neutral' | 'curious' | 'amused' | 'concerned' | 'skeptical' }>('/api/ai/persona', { message, persona, evidence: story ? evidenceFor([story]) : [], recentMessages, directlyAddressed, peerMessage, mode }, signal)

export const draftReport = (topic: string, brief: string, evidence: Story[], helpers: Persona[]) =>
  post<AiResult>('/api/ai/report', { topic, brief, evidence: evidenceFor(evidence), helpers: helpers.map((persona) => persona.name) })
