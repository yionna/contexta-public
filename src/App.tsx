import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Bookmark, Bot, Check, ChevronDown, Clock3, Coffee, FolderOpen,
  GitFork, Globe2, HelpCircle, Image, LockKeyhole, Maximize2, MessageCircle, Minimize2,
  Newspaper, Palette, Plus, Radio, Save, Search, Send, Settings, Share2, ShieldCheck,
  Reply, ShoppingBag, Sparkles, Star, StickyNote, TriangleAlert, UserRound, X,
  Volume2,
} from 'lucide-react'
import ForceGraph3D from 'react-force-graph-3d'
import type { ForceGraphMethods } from 'react-force-graph-3d'
import { personas as defaultPersonas, regions, type Persona, type Story } from './data'
import { askPersona, checkArticleAccess, draftReport, fetchDevelopments, type DevelopmentItem, type LiveNewsItem, type PersonaThreadMessage } from './lib/ai'
import catHouse from './assets/contexta-cat-house.png'
import catStates from './assets/contexta-cat-states-v3.png'
import './App.css'

type AppId = 'news' | 'rooms' | 'reports' | 'notes' | 'sources' | 'settings' | 'shop'
type SortMode = 'top' | 'latest'
type BrowseMode = 'timeline' | 'category'
type NewsLoadState = 'loading' | 'ready' | 'error'
type RoomId = string
type ThemeId = 'cloud' | 'strawberry' | 'night'
type CatMood = 'idle' | 'playful' | 'eating' | 'sleeping' | 'startled' | 'angry' | 'butterfly' | 'cool'
type WindowRect = { x: number; y: number; width: number; height: number }
type WindowState = { open: boolean; minimized: boolean; maximized: boolean; z: number; rect?: WindowRect }
type Message = { id: string; author: string; personaId?: string; text: string; time: string; user?: boolean; reaction?: string; storyId?: string; storyTitle?: string; replyToId?: string; sources?: { id: string; title: string; url: string }[] }
type Room = { id: RoomId; label: string; description: string; story?: Story; dmPersonaId?: string; messages: Message[] }
type PendingShare = { story: Story; destination: RoomId }
type RoomTyping = { roomId: RoomId; personaId: string; activity?: 'reading' | 'searching' | 'typing' }
type PrivateNote = { id: string; title: string; topic: string; body: string; updatedAt: string }

const appInfo: Record<AppId, { title: string; subtitle: string; icon: typeof Newspaper; color: string }> = {
  news: { title: 'TL;DR', subtitle: 'Headline dump', icon: Newspaper, color: '#ff8fbb' },
  rooms: { title: 'CHAT', subtitle: 'always questioning', icon: MessageCircle, color: '#8eabe8' },
  reports: { title: 'CONNECTIONS', subtitle: 'the interesting bit is usually between things', icon: Share2, color: '#f4b36f' },
  notes: { title: 'POST-IT', subtitle: '', icon: StickyNote, color: '#f3cc72' },
  sources: { title: 'SOURCES', subtitle: 'where links come from · verify before trusting', icon: ShieldCheck, color: '#99c89a' },
  settings: { title: 'PREFERENCES', subtitle: 'regions and desktop look', icon: Settings, color: '#c8a7e8' },
  shop: { title: 'CAT HOUSE', subtitle: 'a pixel doorway and little supporter corner', icon: ShoppingBag, color: '#ee9fb5' },
}
const visibleAppIds: AppId[] = ['news', 'rooms', 'reports', 'shop']
const profileIcons = ['YX', '✦', ':3', '☾', '☕', '♪', '♡', '★', '00', '☁']

const initialWindows: Record<AppId, WindowState> = {
  news: { open: true, minimized: false, maximized: true, z: 2 },
  rooms: { open: false, minimized: false, maximized: false, z: 1 },
  reports: { open: false, minimized: false, maximized: false, z: 1 },
  notes: { open: false, minimized: false, maximized: false, z: 1 },
  sources: { open: false, minimized: false, maximized: false, z: 1 },
  settings: { open: false, minimized: false, maximized: false, z: 1 },
  shop: { open: false, minimized: false, maximized: false, z: 1 },
}

const windowPlacements: Record<AppId, { top: string; left: string; width: string; height: string }> = {
  news: { top: '5%', left: '8%', width: '83%', height: '84%' },
  rooms: { top: '9%', left: '19%', width: '70%', height: '76%' },
  reports: { top: '12%', left: '13%', width: '72%', height: '72%' },
  notes: { top: '13%', left: '18%', width: '66%', height: '69%' },
  sources: { top: '18%', left: '25%', width: '62%', height: '62%' },
  settings: { top: '8%', left: '23%', width: '65%', height: '78%' },
  shop: { top: '20%', left: '34%', width: '43%', height: '54%' },
}

const hostname = (url: string) => new URL(url).hostname.replace(/^www\./, '')
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const rank = (story: Story) => story.importance * .58 + story.attention * .32 + story.sourceCount * .7
const normalizedNewsText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
const liveItemToStory = (item: LiveNewsItem | DevelopmentItem, index: number): Story => {
  const parsedDate = new Date(item.publishedAt)
  const compactDate = item.publishedAt?.match(/^(\d{4})(\d{2})(\d{2})/)?.slice(1).join('-')
  const date = compactDate || (!Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
  const coverage = 'coverage' in item ? item.coverage : [item]
  const normalizedTitle = normalizedNewsText(item.title)
  const indexedSummaries = [...new Set(coverage.map((source) => source.summary?.trim()).filter((summary): summary is string => Boolean(summary) && normalizedNewsText(summary ?? '') !== normalizedTitle && normalizedNewsText(summary ?? '').split(' ').length >= 8))].slice(0, 3)
  const annotation = 'annotation' in item ? item.annotation : undefined
  const post = indexedSummaries.length ? indexedSummaries : [annotation?.rationale || `The live index currently provides a headline and source metadata for this development, but not enough article text for a full-content summary.`]
  if (annotation?.tension && !post.some((paragraph) => paragraph.includes(annotation.tension))) post.push(`The model flags this tension from the indexed coverage: ${annotation.tension}`)
  return {
    id: item.id, title: item.title, post, sourceSummary: indexedSummaries.join('\n'),
    region: 'Global', topics: ['Live news'], period: date, firstSeen: date, peakPeriod: date,
    importance: Math.max(45, 80 - index), attention: Math.max(35, 70 - index), importanceLabel: 'live coverage', attentionLabel: 'coverageSignal' in item ? item.coverageSignal : 'newly indexed', sourceCount: 'sourceCount' in item ? item.sourceCount : 1,
    sources: coverage.map((source) => ({ publisher: source.domain, url: source.sourceUrl, publishedAt: source.publishedAt, tier: 'community' as const, verified: false })), annotation,
    reactions: { star: 0, hmm: 0, wow: 0 }, discussion: [],
  }
}

const loadStringSet = (key: string) => {
  try { const stored = JSON.parse(localStorage.getItem(key) ?? '[]'); return new Set<string>(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []) } catch { return new Set<string>() }
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentionsPersona = (text: string, persona: Persona) => {
  const labels = [persona.name, persona.handle.replace(/^@/, ''), ...(persona.id === 'mika' ? ['kika'] : [])].filter(Boolean).sort((a, b) => b.length - a.length)
  return labels.some((label) => new RegExp(`(?:^|[\\s,!?])@?${escapeRegExp(label)}(?=$|[\\s,!?'.:])`, 'i').test(text))
}
const stripLeadingSpeakerLabel = (text: string, speaker: Persona) => {
  let cleaned = text.trim()
  const labels = [speaker.name, speaker.handle.replace(/^@/, '')].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const label of labels) {
    const escaped = escapeRegExp(label)
    cleaned = cleaned.replace(new RegExp(`^\\(\\s*(?:\\*\\*)?@?${escaped}(?:\\*\\*)?\\s*[:：]\\s*([\\s\\S]*?)\\s*\\)$`, 'i'), '$1')
    cleaned = cleaned.replace(new RegExp(`^(?:\\*\\*)?@?${escaped}(?:\\*\\*)?\\s*[:：]\\s*`, 'i'), '')
  }
  return cleaned.trim()
}
const isSummaryTurn = (text: string, recent: Message[]) => {
  if (/\b(?:summari[sz]e|summary|tldr|tl;dr|explain|context|what happened|short version|catch me up)\b/i.test(text)) return true
  const previous = recent.at(-1)?.text ?? ''
  return /\b(?:news|story|article|the one i shared)\b/i.test(text) && /\b(?:summari[sz]e|summary|news or (?:the )?(?:conversation|convo)|tldr)\b/i.test(previous)
}
const isRoomCall = (text: string) => /^(?:hey\s+)?(?:guys|everyone|yall|y'all|people|hello|hi)[!?.\s]*$/i.test(text.trim())
const isGroupTurn = (text: string) => /\b(?:guys|everyone|all of you|(?:mika|kika).{0,30}ren.{0,30}sora)\b/i.test(text) && /\b(?:think|thoughts?|opinion|take|mean)\b/i.test(text)
const personaCategoryAffinity: Record<string, Record<string, number>> = {
  mika: { 'culture-society': 10, 'models-capabilities': 7, deployment: 7, 'business-labor': 4, infrastructure: 3, 'science-health': 2, governance: 2, security: 1 },
  ren: { 'models-capabilities': 10, infrastructure: 10, security: 9, deployment: 8, 'science-health': 8, governance: 4, 'business-labor': 3, 'culture-society': 2 },
  sora: { governance: 10, security: 9, 'culture-society': 9, 'business-labor': 6, deployment: 4, infrastructure: 4, 'science-health': 3, 'models-capabilities': 2 },
  jules: { 'business-labor': 10, deployment: 9, infrastructure: 7, 'models-capabilities': 6, 'culture-society': 5, governance: 4, security: 3, 'science-health': 2 },
}
const personaInterestTerms: Record<string, string[]> = {
  mika: ['design', 'interface', 'creative', 'artist', 'media', 'workflow', 'user', 'culture', 'writing', 'image', 'video'],
  ren: ['model', 'benchmark', 'code', 'agent', 'security', 'research', 'infrastructure', 'science', 'data', 'open source', 'technical'],
  sora: ['policy', 'regulation', 'government', 'governance', 'rights', 'power', 'safety', 'public', 'law', 'election', 'society'],
  jules: ['business', 'market', 'company', 'cost', 'labor', 'funding', 'revenue', 'startup', 'adoption', 'enterprise', 'deal', 'jobs'],
}
const stableHash = (value: string) => [...value].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261)
const waitForHumanTempo = (persona: Persona, seed: string, signal: AbortSignal) => {
  if (persona.kind === 'bot') return Promise.resolve()
  const readingTime = Math.min(1_600, seed.length * 7)
  const personalityBeat = persona.id === 'sora' ? 500 : persona.id === 'ren' ? -150 : persona.id === 'jules' ? 250 : 100
  const delay = Math.max(1_300, Math.min(5_200, 1_500 + readingTime + personalityBeat + stableHash(`${persona.id}:${seed}`) % 1_500))
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = window.setTimeout(finish, delay)
    signal.addEventListener('abort', finish, { once: true })
  })
}
const storyInterestText = (story?: Story) => !story ? '' : [story.title, ...story.post, story.annotation?.primaryCategory, ...(story.annotation?.tags ?? []), ...(story.annotation?.actors ?? []), ...(story.annotation?.technologies ?? []), ...(story.annotation?.domains ?? []), ...(story.annotation?.affectedGroups ?? []), ...(story.annotation?.policyIssues ?? []), ...(story.annotation?.concerns ?? []), story.annotation?.tension].filter(Boolean).join(' ').toLowerCase()
const rankPeopleForStory = (story: Story | undefined, people: Persona[]) => {
  const category = story?.annotation?.primaryCategory ?? ''
  const text = storyInterestText(story)
  return people.map((persona) => {
    const categoryScore = personaCategoryAffinity[persona.id]?.[category] ?? 3
    const termScore = (personaInterestTerms[persona.id] ?? []).reduce((score, term) => score + (text.includes(term) ? 2 : 0), 0)
    const describedInterest = [...persona.concerns, ...persona.attention].reduce((score, phrase) => score + phrase.toLowerCase().split(/\W+/).filter((word) => word.length > 5 && text.includes(word)).length, 0)
    return { persona, score: categoryScore + Math.min(termScore, 8) + Math.min(describedInterest, 4) + (stableHash(`${story?.id}:${persona.id}`) % 3) }
  }).sort((a, b) => b.score - a.score)
}
const discussionSchedule = (story: Story, people: Persona[]) => {
  const ranked = rankPeopleForStory(story, people)
  if (!ranked.length) return []
  const topScore = ranked[0].score
  const participants = ranked.filter((entry, index) => index < 2 || (index === 2 && entry.score >= topScore - 4)).slice(0, 3).map((entry) => entry.persona)
  if (participants.length === 1) return participants
  const schedule = [...participants]
  schedule.push(stableHash(story.id) % 2 === 0 ? participants[0] : participants[1])
  return schedule.slice(0, 4)
}
const loadNotes = () => {
  try { const stored = JSON.parse(localStorage.getItem('contexta-notes') ?? 'null'); if (Array.isArray(stored)) return stored as PrivateNote[] } catch { /* Use the starter note. */ }
  return [{ id: 'welcome-note', title: 'tiny thought', topic: 'ideas', body: 'the best signal is sometimes the detail everyone else skipped.', updatedAt: 'just now' }]
}
const loadVolume = (key: string, fallback: number) => {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const stored = Number(raw)
  return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : fallback
}

function App() {
  const [windows, setWindows] = useState(initialWindows)
  const [highestZ, setHighestZ] = useState(3)
  const [startOpen, setStartOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('top')
  const [browseMode, setBrowseMode] = useState<BrowseMode>('category')
  const [newsSearch, setNewsSearch] = useState('')
  const [newsRefresh, setNewsRefresh] = useState(0)
  const [liveStories, setLiveStories] = useState<Story[]>([])
  const [newsLoadState, setNewsLoadState] = useState<NewsLoadState>('loading')
  const [newsStatus, setNewsStatus] = useState('loading the live 30-day newswire…')
  const [selectedRegions, setSelectedRegions] = useState<string[]>(['Global', 'Southeast Asia'])
  const [systemVolume, setSystemVolume] = useState(() => loadVolume('contexta-system-volume', .92))
  const [saved, setSaved] = useState<Set<string>>(() => loadStringSet('contexta-saved'))
  const [activeRoom, setActiveRoom] = useState<RoomId>('shared-story')
  const [rooms, setRooms] = useState<Record<string, Room>>(() => ({
    'shared-story': { id: 'shared-story', label: 'shared-story', description: 'share a live TL;DR development here to start', messages: [] },
    'creative-tools': { id: 'creative-tools', label: 'creative-tools', description: 'visual ai, workflows, and what is actually usable', messages: [
      { id: 'creative-1', author: 'Mika', personaId: 'mika', text: 'drop demos here, but tell me what the editing workflow is like after the pretty render', time: '12m' },
      { id: 'creative-2', author: 'Ren', personaId: 'ren', text: 'i can help check whether there is code, weights, or only a launch video', time: '9m' },
    ] },
    'policy-sidechat': { id: 'policy-sidechat', label: 'policy-sidechat', description: 'quiet implementation details and institutional gossip', messages: [
      { id: 'policy-1', author: 'Sora', personaId: 'sora', text: 'small guidance updates welcome. those often matter more than a keynote', time: '18m' },
    ] },
  }))
  const [roomInput, setRoomInput] = useState('')
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null)
  const [roomReplyToId, setRoomReplyToId] = useState('')
  const [roomBusy, setRoomBusy] = useState(false)
  const [roomTyping, setRoomTyping] = useState<RoomTyping | null>(null)
  const roomRunRef = useRef<Record<string, number>>({})
  const roomAbortRef = useRef<Record<string, AbortController>>({})
  const personaState = defaultPersonas
  const [notes, setNotes] = useState<PrivateNote[]>(loadNotes)
  const [activeNoteId, setActiveNoteId] = useState('welcome-note')
  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem('contexta-theme') as ThemeId) || 'cloud')
  const [profileAvatar, setProfileAvatar] = useState(() => localStorage.getItem('contexta-avatar') || 'YX')
  const [profileName, setProfileName] = useState(() => localStorage.getItem('contexta-profile-name') || 'You')
  const [profileOpen, setProfileOpen] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [focusedStoryId, setFocusedStoryId] = useState('')
  const [catMood, setCatMood] = useState<CatMood>('idle')
  const lastCatInteractionRef = useRef(Date.now())
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('contexta-onboarded') === 'yes')
  const [setupRegions, setSetupRegions] = useState<string[]>(['Global'])
  const allStories = useMemo(() => newsLoadState === 'ready' ? liveStories : [], [liveStories, newsLoadState])

  useEffect(() => {
    const interval = window.setInterval(() => setNewsRefresh((value) => value + 1), 15 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => { localStorage.setItem('contexta-saved', JSON.stringify([...saved])) }, [saved])
  useEffect(() => { localStorage.setItem('contexta-notes', JSON.stringify(notes)) }, [notes])
  useEffect(() => { const interval = window.setInterval(() => setClock(new Date()), 15_000); return () => window.clearInterval(interval) }, [])
  useEffect(() => () => Object.values(roomAbortRef.current).forEach((controller) => controller.abort()), [])
  useEffect(() => {
    const next: Partial<Record<CatMood, { mood: CatMood; delay: number }>> = {
      eating: { mood: 'playful', delay: 2_400 }, playful: { mood: 'sleeping', delay: 7_000 },
      butterfly: { mood: 'idle', delay: 6_000 }, cool: { mood: 'idle', delay: 6_000 },
      startled: { mood: 'angry', delay: 850 }, angry: { mood: 'idle', delay: 9_000 },
    }
    const transition = next[catMood]
    if (!transition) return
    const timeout = window.setTimeout(() => setCatMood(transition.mood), transition.delay)
    return () => window.clearTimeout(timeout)
  }, [catMood])
  useEffect(() => {
    const interval = window.setInterval(() => {
      const quietFor = Date.now() - lastCatInteractionRef.current
      if (quietFor > 90_000) setCatMood((current) => current === 'sleeping' ? current : 'angry')
      else if (quietFor > 35_000) setCatMood((current) => current === 'idle' ? (Math.random() > .68 ? 'sleeping' : Math.random() > .5 ? 'butterfly' : 'cool') : current)
    }, 12_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => fetchDevelopments().then(({ items, refreshedAt }) => {
        if (cancelled) return
        const next = items.map(liveItemToStory)
        setLiveStories(next)
        setNewsLoadState('ready')
        setNewsStatus(`${next.length} live records · refreshed ${new Date(refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
      }).catch((error) => { if (!cancelled) { setNewsLoadState('error'); setNewsStatus(error instanceof Error ? error.message : 'Live news unavailable.') } }), 450)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [newsRefresh])

  const openApp = (id: AppId) => {
    const nextZ = highestZ + 1
    setHighestZ(nextZ)
    setWindows((current) => ({ ...current, [id]: { ...current[id], open: true, minimized: false, z: nextZ } }))
    setStartOpen(false)
  }
  const focusApp = (id: AppId) => {
    const nextZ = highestZ + 1
    setHighestZ(nextZ)
    setWindows((current) => ({ ...current, [id]: { ...current[id], z: nextZ, minimized: false } }))
  }
  const patchWindow = (id: AppId, patch: Partial<WindowState>) => setWindows((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  const changeProfileName = (next: string) => { setProfileName(next); localStorage.setItem('contexta-profile-name', next) }

  const displayedStories = useMemo(() => {
    const query = newsSearch.trim().toLowerCase()
    const filtered = allStories.filter((story) => {
      const searchMatch = !query || `${story.title} ${story.post.join(' ')} ${story.topics.join(' ')} ${story.annotation?.primaryCategory ?? ''} ${(story.annotation?.concerns ?? []).join(' ')}`.toLowerCase().includes(query)
      return searchMatch
    })
    return filtered.sort((a, b) => sortMode === 'latest' ? b.firstSeen.localeCompare(a.firstSeen) : rank(b) - rank(a))
  }, [allStories, newsSearch, sortMode])

  const toggleSaved = (storyId: string) => setSaved((current) => toggleSet(current, storyId))
  const openDm = (persona: Persona) => {
    const roomId = `dm-${persona.id}`
    setRooms((current) => current[roomId] ? current : { ...current, [roomId]: { id: roomId, label: persona.name.toLowerCase(), description: `direct messages with ${persona.name}`, dmPersonaId: persona.id, messages: [] } })
    setActiveRoom(roomId)
    setRoomReplyToId('')
    openApp('rooms')
  }
  const beginRoomRun = (roomId: RoomId) => {
    roomAbortRef.current[roomId]?.abort()
    setRoomTyping((current) => current?.roomId === roomId ? null : current)
    const controller = new AbortController()
    const run = (roomRunRef.current[roomId] ?? 0) + 1
    roomRunRef.current[roomId] = run
    roomAbortRef.current[roomId] = controller
    return { run, controller, current: () => roomRunRef.current[roomId] === run }
  }
  const stageShare = (story: Story, destination: RoomId) => {
    setPendingShare({ story, destination })
    setActiveRoom(destination)
    setRoomReplyToId('')
    openApp('rooms')
  }
  const deliverSharedStory = (story: Story, destination: RoomId, comment = '') => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const shareId = `share-${Date.now()}`
    const shareMessage: Message = { id: shareId, author: 'you', text: comment, time: now, user: true, storyId: story.id, storyTitle: story.title }
    setRooms((current) => {
      const target = current[destination]
      if (!target) return current
      return { ...current, [destination]: { ...target, story, messages: [...target.messages, shareMessage] } }
    })
    setActiveRoom(destination)
    setRoomReplyToId('')
    openApp('rooms')
    const generation = beginRoomRun(destination)
    setRoomBusy(true)
    void (async () => {
      const targetRoom = rooms[destination]
      const lilBot = personaState.find((persona) => persona.kind === 'bot')
      if (!lilBot || !targetRoom) return
      const baseContext: PersonaThreadMessage[] = [...targetRoom.messages.slice(-12).map((message) => ({ author: message.author, text: message.text || message.storyTitle || '', personaId: message.personaId })), { author: 'you', text: `shared from TL;DR: ${story.title}${comment ? `\ncomment: ${comment}` : ''}` }]
      setRoomTyping({ roomId: destination, personaId: lilBot.id, activity: 'reading' })
      const { accessible: originalAccessible } = await checkArticleAccess(story, generation.controller.signal)
      if (!generation.current()) return
      setRoomTyping({ roomId: destination, personaId: lilBot.id, activity: originalAccessible ? 'typing' : 'searching' })
      const briefing = await askPersona('Read the shared article and explain what happened, its context, why it matters, and what the source does not establish.', lilBot, story, baseContext, true, undefined, 'share-briefing', generation.controller.signal)
      if (!generation.current()) return
      const briefingMessage: Message = { id: `brief-${Date.now()}`, author: lilBot.name, personaId: lilBot.id, text: stripLeadingSpeakerLabel(briefing.text, lilBot), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), reaction: briefing.reaction, sources: briefing.sources }
      setRooms((current) => current[destination] ? { ...current, [destination]: { ...current[destination], messages: [...current[destination].messages, briefingMessage] } } : current)

      const groundedBriefing = briefing.briefingReady === true && ['original', 'fallback-search', 'publisher-feed'].includes(briefing.sourceAccess ?? '')
      if (!groundedBriefing) return

      const dmPersonaId = targetRoom.dmPersonaId
      const people = personaState.filter((persona) => persona.kind === 'person' && persona.active && (!dmPersonaId || persona.id === dmPersonaId))
      const speakers = dmPersonaId ? people.slice(0, 1) : discussionSchedule(story, people)
      const reactionContext: PersonaThreadMessage[] = [...baseContext, { author: lilBot.name, personaId: lilBot.id, text: briefingMessage.text, replyToAuthor: 'you', replyToText: story.title }]
      const reactions: Message[] = []
      for (const persona of speakers) {
        if (!generation.current()) return
        const peer = reactions.at(-1) ?? briefingMessage
        const generated = [briefingMessage, ...reactions]
        const context = [...reactionContext, ...reactions.map((message) => {
          const quoted = generated.find((candidate) => candidate.id === message.replyToId)
          return { author: message.author, personaId: message.personaId, text: message.text, replyToAuthor: quoted?.author, replyToText: quoted?.text }
        })]
        setRoomTyping({ roomId: destination, personaId: persona.id })
        const [result] = await Promise.all([
          askPersona('React only if this story or the latest point genuinely catches your interest. Answer, challenge, extend, tease, or raise one genuine question. If you already spoke, come back only to answer or challenge the newer reply. Do not repeat the briefing.', persona, story, context, false, { name: peer.author, text: peer.text }, 'share-reaction', generation.controller.signal),
          waitForHumanTempo(persona, `${story.title}:${peer.text}`, generation.controller.signal),
        ])
        if (!generation.current() || result.pass) continue
        const reaction: Message = { id: `reaction-${Date.now()}-${reactions.length}`, author: persona.name, personaId: persona.id, text: stripLeadingSpeakerLabel(result.text, persona), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), reaction: result.reaction, sources: result.sources, replyToId: peer.id }
        reactions.push(reaction)
        setRooms((current) => current[destination] ? { ...current, [destination]: { ...current[destination], messages: [...current[destination].messages, reaction] } } : current)
      }
    })().catch((error) => {
      if (!generation.current() || generation.controller.signal.aborted) return
      setRooms((current) => current[destination] ? { ...current, [destination]: { ...current[destination], messages: [...current[destination].messages, { id: `error-${Date.now()}`, author: 'system', text: error instanceof Error ? error.message : 'The desk could not finish reading this article.', time: now }] } } : current)
    }).finally(() => { if (generation.current()) { setRoomTyping(null); setRoomBusy(false) } })
  }
  const openStoryInNews = (storyId: string) => { setFocusedStoryId(storyId); openApp('news') }
  const sendRoomMessage = async () => {
    const text = roomInput.trim()
    const attachedStory = pendingShare?.destination === activeRoom ? pendingShare.story : undefined
    if (!text && !attachedStory) return
    if (attachedStory) {
      setRoomInput('')
      setRoomReplyToId('')
      setPendingShare(null)
      deliverSharedStory(attachedStory, activeRoom, text)
      return
    }
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const activePersonas = personaState.filter((persona) => persona.active)
    const room = rooms[activeRoom]
    const replyingTo = room.messages.find((message) => message.id === roomReplyToId)
    const mentioned = activePersonas.filter((persona) => mentionsPersona(text, persona))
    const mentionedIds = new Set(mentioned.map((persona) => persona.id))
    const lastMessage = room.messages.at(-1)
    const continuingWith = lastMessage?.personaId ? activePersonas.find((persona) => persona.id === lastMessage.personaId) : undefined
    const replyingToPersona = replyingTo?.personaId ? activePersonas.find((persona) => persona.id === replyingTo.personaId) : undefined
    const summaryTurn = isSummaryTurn(text, room.messages)
    const lilBot = activePersonas.find((persona) => persona.id === 'lilbot' || persona.name.toLowerCase() === 'lil bot')
    const dmPersona = room.dmPersonaId ? activePersonas.find((persona) => persona.id === room.dmPersonaId) : undefined
    const roomCall = isRoomCall(text)
    const groupTurn = isGroupTurn(text)
    const people = activePersonas.filter((persona) => persona.kind === 'person')
    const interestedPeople = rankPeopleForStory(room.story, people).map((entry) => entry.persona)
    const chosen = mentioned.length ? mentioned.slice(0, 4) : replyingToPersona ? [replyingToPersona] : dmPersona ? [dmPersona] : groupTurn ? interestedPeople : summaryTurn && lilBot ? [lilBot] : continuingWith ? [continuingWith] : [...interestedPeople, ...activePersonas.filter((persona) => !interestedPeople.includes(persona))].slice(0, 2)
    const directIds = new Set(mentionedIds)
    if (!mentioned.length && groupTurn) chosen.forEach((persona) => directIds.add(persona.id))
    else if (!mentioned.length && (replyingToPersona || dmPersona || summaryTurn || continuingWith || roomCall) && chosen[0]) directIds.add(chosen[0].id)
    const userMessageId = `user-${Date.now()}`
    const userMessage: Message = { id: userMessageId, author: 'you', text, time: now, user: true, replyToId: replyingTo?.id }
    setRooms((current) => ({ ...current, [activeRoom]: { ...current[activeRoom], messages: [
      ...current[activeRoom].messages,
      userMessage,
    ] } }))
    setRoomInput('')
    setRoomReplyToId('')
    const generation = beginRoomRun(activeRoom)
    if (!chosen.length) { setRoomBusy(false); return }
    setRoomBusy(true)
    try {
      const replies: Message[] = []
      for (const persona of chosen) {
        const peer = replies.at(-1)
        const contextMessages = [...room.messages.slice(-18), userMessage, ...replies]
        const allContextMessages = [...room.messages, userMessage, ...replies]
        const recent: PersonaThreadMessage[] = contextMessages.map((message) => {
          const quoted = message.replyToId ? allContextMessages.find((candidate) => candidate.id === message.replyToId) : undefined
          return {
            author: message.author,
            text: message.text || message.storyTitle || '',
            personaId: message.personaId,
            replyToAuthor: quoted?.author,
            replyToText: quoted?.text || quoted?.storyTitle,
          }
        })
        setRoomTyping({ roomId: activeRoom, personaId: persona.id })
        const [result] = await Promise.all([
          askPersona(text, persona, room.story, recent, directIds.has(persona.id), peer ? { name: peer.author, text: peer.text } : undefined, 'chat', generation.controller.signal),
          waitForHumanTempo(persona, `${text}:${peer?.text ?? ''}`, generation.controller.signal),
        ])
        if (!generation.current()) return
        if (result.pass) continue
        const reply: Message = { id: `persona-${Date.now()}-${replies.length}`, author: persona.name, personaId: persona.id, text: stripLeadingSpeakerLabel(result.text, persona), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), reaction: result.reaction, sources: result.sources, replyToId: peer?.id }
        replies.push(reply)
        setRooms((current) => ({ ...current, [activeRoom]: { ...current[activeRoom], messages: [...current[activeRoom].messages, reply] } }))
      }
    } catch (error) {
      if (!generation.current() || generation.controller.signal.aborted) return
      setRooms((current) => ({ ...current, [activeRoom]: { ...current[activeRoom], messages: [...current[activeRoom].messages, { id: `error-${Date.now()}`, author: 'system', text: error instanceof Error ? error.message : 'The live AI service is unavailable.', time: now }] } }))
    } finally { if (generation.current()) { setRoomTyping(null); setRoomBusy(false) } }
  }
  const shareNote = (note: PrivateNote) => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setRooms((current) => ({ ...current, [activeRoom]: { ...current[activeRoom], messages: [...current[activeRoom].messages, { id: `note-${Date.now()}`, author: 'you', text: `shared a private note: “${note.title}”\n${note.body}`, time: now, user: true }] } }))
    openApp('rooms')
  }
  const changeTheme = (next: ThemeId) => { setTheme(next); localStorage.setItem('contexta-theme', next) }
  const changeSystemVolume = (next: number) => { setSystemVolume(next); localStorage.setItem('contexta-system-volume', String(next)) }
  const changeAvatar = (next: string) => { setProfileAvatar(next); localStorage.setItem('contexta-avatar', next) }
  const petCat = () => {
    lastCatInteractionRef.current = Date.now()
    setCatMood((current) => current === 'sleeping' ? 'startled' : (['playful', 'butterfly', 'cool'] as CatMood[])[Math.floor(Math.random() * 3)])
  }
  const feedCat = () => {
    lastCatInteractionRef.current = Date.now()
    setCatMood('eating')
  }
  const finishOnboarding = () => {
    const next = setupRegions.length ? setupRegions : ['Global']
    setSelectedRegions(next)
    localStorage.setItem('contexta-onboarded', 'yes')
    setOnboarded(true)
  }

  return <div className={`desktop-shell theme-${theme}`}>
    <DesktopSound systemVolume={systemVolume} />
    <div className="wallpaper-orb orb-one" /><div className="wallpaper-orb orb-two" />
    <div className="desktop-brand"><span>CONTEXTA</span><small>We prompt how you understand news.</small></div>

    <div className="desktop-icons" aria-label="Desktop applications">
      {visibleAppIds.map((id) => {
        const item = appInfo[id]; const Icon = item.icon
        return <button key={id} onClick={() => openApp(id)}><span style={{ '--app-color': item.color } as React.CSSProperties}><Icon /></span><b>{item.title}</b></button>
      })}
    </div>

    {(Object.keys(windows) as AppId[]).map((id) => windows[id].open && !windows[id].minimized && (
      <DesktopWindow key={id} id={id} state={windows[id]} onFocus={() => focusApp(id)} onRectChange={(rect) => patchWindow(id, { rect })} onClose={() => patchWindow(id, { open: false })} onMinimize={() => patchWindow(id, { minimized: true })} onMaximize={() => patchWindow(id, { maximized: !windows[id].maximized })}>
        {id === 'news' && <NewsApp stories={displayedStories} status={newsStatus} loadState={newsLoadState} sortMode={sortMode} setSortMode={setSortMode} browseMode={browseMode} setBrowseMode={setBrowseMode} search={newsSearch} setSearch={setNewsSearch} saved={saved} onSave={toggleSaved} onShare={stageShare} rooms={rooms} focusedStoryId={focusedStoryId} />}
        {id === 'rooms' && <RoomsApp room={rooms[activeRoom]} rooms={rooms} activeRoom={activeRoom} onChangeRoom={(roomId) => { setActiveRoom(roomId); setRoomReplyToId('') }} personas={personaState} profileName={profileName} profileAvatar={profileAvatar} input={roomInput} setInput={setRoomInput} pendingStory={pendingShare?.destination === activeRoom ? pendingShare.story : undefined} onRemovePending={() => setPendingShare(null)} onSend={sendRoomMessage} busy={roomBusy} typing={roomTyping} replyToId={roomReplyToId} setReplyToId={setRoomReplyToId} onOpenProfile={() => setProfileOpen(true)} onOpenStory={(storyId) => storyId && openStoryInNews(storyId)} onOpenDm={openDm} />}
        {id === 'reports' && <ConnectionsApp availableStories={allStories} theme={theme} onOpenStory={(story) => openStoryInNews(story.id)} />}
        {id === 'notes' && <NotesApp notes={notes} setNotes={setNotes} activeId={activeNoteId} setActiveId={setActiveNoteId} onShare={shareNote} />}
        {id === 'sources' && <SourcesApp availableStories={allStories} />}
        {id === 'settings' && <SettingsApp selectedRegions={selectedRegions} setSelectedRegions={setSelectedRegions} theme={theme} setTheme={changeTheme} systemVolume={systemVolume} setSystemVolume={changeSystemVolume} />}
        {id === 'shop' && <ShopApp />}
      </DesktopWindow>
    ))}

    {startOpen && <div className="start-menu"><div className="start-banner"><Sparkles /><span>contexta<small>what happened while you were away?</small></span></div>{visibleAppIds.map((id) => { const item = appInfo[id]; const Icon = item.icon; return <button key={id} onClick={() => openApp(id)}><Icon style={{ color: item.color }} /><span>{item.title}<small>{item.subtitle}</small></span></button> })}<div className="start-status"><Radio /> grounded Qwen API · server-side key</div></div>}

    <footer className="taskbar">
      <button className={startOpen ? 'start-button active' : 'start-button'} onClick={() => setStartOpen((value) => !value)}><Sparkles /> start</button>
      <div className="task-divider" />
      <div className="task-apps">{(Object.keys(windows) as AppId[]).filter((id) => windows[id].open && id !== 'settings').map((id) => { const item = appInfo[id]; const Icon = item.icon; return <button key={id} className={!windows[id].minimized && windows[id].z === Math.max(...Object.values(windows).filter((item) => item.open && !item.minimized).map((item) => item.z), 0) ? 'active' : ''} onClick={() => focusApp(id)}><Icon /><span>{item.title}</span></button> })}</div>
      <div className="tray"><span><Globe2 /> {selectedRegions.length} regions</span><button className="tray-chat" onClick={() => openApp('rooms')} aria-label="Open chat" title="Chat"><MessageCircle /></button><button className="tray-settings" onClick={() => openApp('settings')} aria-label="Open preferences" title="Preferences"><Settings /></button><button className="tray-avatar" onClick={() => setProfileOpen((value) => !value)} aria-label="Open profile settings">{profileAvatar}</button><time>{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
    </footer>

    {profileOpen && <div className="profile-popover"><header><div className="profile-large-avatar">{profileAvatar}</div><div><b>{profileName || 'You'}</b><small>local Contexta profile</small></div><button className="profile-close" onClick={() => setProfileOpen(false)} aria-label="Close profile"><X /></button></header><label><span>DISPLAY NAME</span><input value={profileName} onChange={(event) => changeProfileName(event.target.value)} /></label><div className="profile-icon-picker"><span>PROFILE ICON</span><div>{profileIcons.map((avatar) => <button key={avatar} className={profileAvatar === avatar ? 'selected' : ''} onClick={() => changeAvatar(avatar)} aria-label={`Use ${avatar} as profile icon`}>{avatar}</button>)}</div></div><div className="profile-summary"><span>{selectedRegions.length} regions</span><span>{personaState.filter((persona) => persona.kind === 'person').length} people</span><span>{theme} theme</span></div><button className="profile-settings-link" onClick={() => { openApp('settings'); setProfileOpen(false) }}><Settings /> open preferences</button></div>}

    <DesktopCat mood={catMood} onPet={petCat} onFeed={feedCat} />

    {!onboarded && <Onboarding selected={setupRegions} setSelected={setSetupRegions} onContinue={finishOnboarding} />}
  </div>
}

function DesktopWindow({ id, state, children, onFocus, onRectChange, onClose, onMinimize, onMaximize }: { id: AppId; state: WindowState; children: React.ReactNode; onFocus: () => void; onRectChange: (rect: WindowRect) => void; onClose: () => void; onMinimize: () => void; onMaximize: () => void }) {
  const item = appInfo[id]; const Icon = item.icon
  const style = state.maximized ? { zIndex: state.z } : state.rect ? { left: state.rect.x, top: state.rect.y, width: state.rect.width, height: state.rect.height, zIndex: state.z } : { ...windowPlacements[id], zIndex: state.z }
  const beginInteraction = (event: React.PointerEvent, kind: 'move' | 'resize', direction = '') => {
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('.desktop-window')
    if (state.maximized || event.button !== 0 || !element) return
    event.preventDefault(); event.stopPropagation(); onFocus()
    const bounds = element.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY, rect: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } }
    const onMove = (pointer: PointerEvent) => {
      const dx = pointer.clientX - start.x; const dy = pointer.clientY - start.y
      const maxWidth = window.innerWidth; const maxHeight = window.innerHeight - 42
      const minWidth = Math.min(400, maxWidth - 12); const minHeight = Math.min(300, maxHeight - 12)
      let { x, y, width, height } = start.rect
      if (kind === 'move') { x += dx; y += dy } else {
        if (direction.includes('e')) width += dx
        if (direction.includes('s')) height += dy
        if (direction.includes('w')) { x += dx; width -= dx }
        if (direction.includes('n')) { y += dy; height -= dy }
        if (width < minWidth) { if (direction.includes('w')) x -= minWidth - width; width = minWidth }
        if (height < minHeight) { if (direction.includes('n')) y -= minHeight - height; height = minHeight }
      }
      width = Math.min(width, maxWidth); height = Math.min(height, maxHeight)
      x = Math.max(0, Math.min(x, maxWidth - Math.min(width, 80)))
      y = Math.max(0, Math.min(y, maxHeight - 31))
      if (kind === 'resize') { width = Math.min(width, maxWidth - x); height = Math.min(height, maxHeight - y) }
      onRectChange({ x, y, width, height })
    }
    const finish = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); document.body.classList.remove('window-interacting') }
    document.body.classList.add('window-interacting')
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }
  return <section className={`desktop-window ${state.maximized ? 'maximized' : ''}`} style={style} onMouseDown={onFocus}>
    <header className="window-titlebar" onPointerDown={(event) => beginInteraction(event, 'move')} onDoubleClick={onMaximize}><div className="window-dots"><button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClose() }} aria-label="Close"><X /></button><button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMinimize() }} aria-label="Minimize"><Minimize2 /></button><button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMaximize() }} aria-label="Maximize"><Maximize2 /></button></div><div className="window-title"><Icon /><b>{item.title}</b><span>— {item.subtitle}</span></div><div className="window-signal"><i /> ONLINE</div></header>
    <div className="window-body">{children}</div>
    {!state.maximized && ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map((direction) => <i key={direction} className={`resize-handle resize-${direction}`} onPointerDown={(event) => beginInteraction(event, 'resize', direction)} />)}
  </section>
}

type NewsAppProps = {
  stories: Story[]; status: string; loadState: NewsLoadState; sortMode: SortMode; setSortMode: (mode: SortMode) => void; search: string; setSearch: (value: string) => void
  browseMode: BrowseMode; setBrowseMode: (mode: BrowseMode) => void; saved: Set<string>; onSave: (id: string) => void; onShare: (story: Story, destination: RoomId) => void; rooms: Record<string, Room>; focusedStoryId: string
}
const categoryColors: Record<string, string> = {
  'models-capabilities': '#7dc8eb', infrastructure: '#8f9fe8', deployment: '#73c4a5', governance: '#b49ae8', 'business-labor': '#f3b561', 'culture-society': '#ef82ac', 'science-health': '#68cbbf', security: '#f06f79', uncategorized: '#aeb6c7',
}
const categoryLabel = (category: string) => category.replaceAll('-', ' & ')

function NewsApp({ stories: visibleStories, status, loadState, sortMode, setSortMode, browseMode, setBrowseMode, search, setSearch, saved, onSave, onShare, rooms, focusedStoryId }: NewsAppProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sharePicker, setSharePicker] = useState('')
  const [hiddenTopics, setHiddenTopics] = useState<Set<string>>(new Set())
  const [topicMenuOpen, setTopicMenuOpen] = useState(false)
  const categories = useMemo(() => [...new Set(visibleStories.map((story) => story.annotation?.primaryCategory ?? 'uncategorized'))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))), [visibleStories])
  const filteredStories = useMemo(() => visibleStories.filter((story) => !hiddenTopics.has(story.annotation?.primaryCategory ?? 'uncategorized')), [hiddenTopics, visibleStories])
  const chronologicalStories = useMemo(() => [...filteredStories].sort((left, right) => right.firstSeen.localeCompare(left.firstSeen) || right.period.localeCompare(left.period)), [filteredStories])
  const groups = useMemo(() => Object.entries(filteredStories.reduce<Record<string, Story[]>>((all, story) => { const category = story.annotation?.primaryCategory ?? 'uncategorized'; (all[category] ??= []).push(story); return all }, {})), [filteredStories])
  useEffect(() => {
    if (!focusedStoryId) return
    const timer = window.setTimeout(() => {
      setExpanded((current) => new Set(current).add(focusedStoryId))
      document.getElementById(`story-${focusedStoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [focusedStoryId])
  const storyCard = (story: Story, category: string) => {
    const isExpanded = expanded.has(story.id)
    return <article id={`story-${story.id}`} className={`tldr-story ${isExpanded ? 'expanded' : ''}`} style={{ '--category': categoryColors[category] ?? categoryColors.uncategorized } as React.CSSProperties} key={story.id} onClick={() => setExpanded((current) => toggleSet(current, story.id))}>
      <div className="story-category-dot" />
      <div className="tldr-story-copy"><div className="tldr-story-meta"><span>{story.annotation?.eventLabel || categoryLabel(category)}</span><time>{story.period}</time></div><h2><HighlightedTitle story={story} /></h2>
        {isExpanded && <div className="tldr-expanded" onClick={(event) => event.stopPropagation()}>{story.post.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{story.annotation?.rationale && <p className="classification-note">Grouped here because {story.annotation.rationale}</p>}<div className="full-urls">{story.sources.map((source) => <a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" key={source.url}>{source.url}</a>)}</div><small>Open and verify every URL before trusting a claim.</small></div>}
      </div>
      <div className="story-hover-actions" onClick={(event) => event.stopPropagation()}><button className={saved.has(story.id) ? 'starred' : ''} onClick={() => onSave(story.id)} title={saved.has(story.id) ? 'Remove star' : 'Star this story'} aria-label={saved.has(story.id) ? 'Remove star' : 'Star this story'}><Star fill={saved.has(story.id) ? 'currentColor' : 'none'} /></button><button onClick={() => setSharePicker((current) => current === story.id ? '' : story.id)} title="Share to a chat" aria-label="Share to a chat"><Share2 /></button></div>
      {sharePicker === story.id && <div className="share-destination" onClick={(event) => event.stopPropagation()}><small>ATTACH TO</small>{Object.values(rooms).map((room) => <button key={room.id} onClick={() => { onShare(story, room.id); setSharePicker('') }}><MessageCircle /><span><b>{room.label}</b><i>{room.description}</i></span></button>)}</div>}
    </article>
  }
  return <div className="news-app">
    <main className="announcement-channel">
      <div className="tldr-toolbar"><div><b>the last 30 days</b><small>{status}</small></div><label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="find a development…" /></label><div className="browse-tabs"><button className={browseMode === 'timeline' ? 'active' : ''} onClick={() => { setBrowseMode('timeline'); setSortMode('latest') }}><Clock3 />time order</button><button className={browseMode === 'category' ? 'active' : ''} onClick={() => setBrowseMode('category')}><FolderOpen />by topic</button></div><div className="topic-filter"><button className="topic-filter-trigger" onClick={() => setTopicMenuOpen((open) => !open)} aria-expanded={topicMenuOpen}><span>{hiddenTopics.size ? `${categories.length - hiddenTopics.size} of ${categories.length} topics` : 'all topics'}</span><ChevronDown /></button>{topicMenuOpen && <div className="topic-menu"><header><b>SHOW TOPICS</b><button onClick={() => setHiddenTopics(new Set())}>all</button><button onClick={() => setHiddenTopics(new Set(categories))}>none</button></header>{categories.map((category) => <button className={hiddenTopics.has(category) ? '' : 'selected'} key={category} onClick={() => setHiddenTopics((current) => toggleSet(current, category))}><i style={{ background: categoryColors[category] ?? categoryColors.uncategorized }} />{categoryLabel(category)}<Check /></button>)}</div>}</div><div className="sort-tabs">{(['top', 'latest'] as SortMode[]).map((mode) => <button key={mode} className={sortMode === mode ? 'active' : ''} onClick={() => { setSortMode(mode); if (mode === 'top' && browseMode === 'timeline') setBrowseMode('category') }}>{mode}</button>)}</div></div>
      <div className="tldr-caution"><HelpCircle /><span>Coverage is a lead, not proof. Expand an item to see the complete URL, then verify it yourself.</span></div>
      <div className={`tldr-feed ${browseMode === 'timeline' ? 'timeline-mode' : ''}`}>{loadState === 'loading' ? <div className="news-loading"><div className="loading-orbit"><i /><i /><i /></div><b>building your last 30 days…</b><span>fetching live coverage, then asking Qwen to group it</span><div className="loading-track"><i /></div></div> : loadState === 'error' ? <div className="news-loading news-error"><TriangleAlert /><b>the live feed did not load</b><span>{status}</span></div> : filteredStories.length === 0 ? <div className="news-loading"><Search /><b>nothing matches this filter</b><span>the live month is loaded; choose more topics or try a broader search</span></div> : browseMode === 'timeline' ? <section className="tldr-timeline">{chronologicalStories.map((story) => storyCard(story, story.annotation?.primaryCategory ?? 'uncategorized'))}</section> : groups.map(([category, grouped]) => <section className="tldr-category" style={{ '--category': categoryColors[category] ?? categoryColors.uncategorized } as React.CSSProperties} key={category}><header><span>{categoryLabel(category)}</span><b>{grouped.length}</b></header>{grouped.map((story) => storyCard(story, category))}</section>)}</div>
    </main>
  </div>
}

function HighlightedTitle({ story }: { story: Story }) {
  const spans = story.annotation?.headlineSpans ?? []
  if (!spans.length) return story.title
  const parts: React.ReactNode[] = []; let cursor = 0
  spans.forEach((span, index) => { if (span.start > cursor) parts.push(story.title.slice(cursor, span.start)); parts.push(<mark className="semantic-shine" key={`${span.start}-${index}`}>{story.title.slice(span.start, span.end)}</mark>); cursor = span.end })
  if (cursor < story.title.length) parts.push(story.title.slice(cursor))
  return parts
}

function RoomsApp({ room, rooms, activeRoom, onChangeRoom, personas, profileName, profileAvatar, input, setInput, pendingStory, onRemovePending, onSend, busy, typing, replyToId, setReplyToId, onOpenProfile, onOpenStory, onOpenDm }: { room: Room; rooms: Record<string, Room>; activeRoom: RoomId; onChangeRoom: (room: RoomId) => void; personas: Persona[]; profileName: string; profileAvatar: string; input: string; setInput: (value: string) => void; pendingStory?: Story; onRemovePending: () => void; onSend: () => void; busy: boolean; typing: RoomTyping | null; replyToId: string; setReplyToId: (id: string) => void; onOpenProfile: () => void; onOpenStory: (storyId?: string) => void; onOpenDm: (persona: Persona) => void }) {
  const [profilePersonaId, setProfilePersonaId] = useState('')
  const mentionMatch = input.match(/(?:^|\s)@([^\s@]*)$/)
  const mentionQuery = mentionMatch?.[1].toLowerCase()
  const mentionOptions = mentionMatch ? personas.filter((persona) => persona.active && (`${persona.name} ${persona.handle}`).toLowerCase().includes(mentionQuery ?? '')) : []
  const insertMention = (persona: Persona) => setInput(input.replace(/@[^@\s]*$/, `@${persona.name} `))
  const roomIds = Object.keys(rooms)
  const replyingTo = room.messages.find((message) => message.id === replyToId)
  const typingPersona = typing?.roomId === room.id ? personas.find((persona) => persona.id === typing.personaId) : undefined
  const messagesEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [room.messages.length, typingPersona?.id, room.id])

  return <div className="rooms-app">
    <aside className="room-sidebar"><div className="channel-heading">TOPICS</div>{roomIds.map((roomId) => <button key={roomId} className={activeRoom === roomId ? 'active' : ''} onClick={() => onChangeRoom(roomId)}># {rooms[roomId].label}</button>)}<div className="channel-heading">WHO'S HERE</div>{personas.filter((persona) => persona.active).map((persona) => <button className="member" key={persona.id} onClick={() => setProfilePersonaId(persona.id)} title={`View ${persona.name}'s profile`}><i style={{ background: persona.color }}>{persona.avatar}</i><span><b>{persona.name}</b><small>{persona.handle}</small></span>{persona.kind === 'bot' && <em>BOT</em>}</button>)}</aside>
    <main className="room-chat"><header><div><b># {room.label}</b><span>{room.description}</span></div><span className={`room-rule ${typingPersona ? 'active' : ''}`}>{typingPersona ? `${typingPersona.name} is ${typing?.activity === 'searching' ? 'searching' : typing?.activity === 'reading' ? 'reading' : 'typing'}` : 'they might stay quiet'}</span></header>
      <div className="messages">{room.messages.map((message) => {
        const persona = personas.find((item) => item.id === message.personaId)
        const quoted = message.replyToId ? room.messages.find((item) => item.id === message.replyToId) : undefined
        return <div className={`message ${message.user ? 'user-message' : ''}`} id={`message-${message.id}`} key={message.id}>
          <button className="message-avatar" style={{ background: persona?.color ?? '#e9f7ff' }} onClick={message.user ? onOpenProfile : persona ? () => setProfilePersonaId(persona.id) : undefined} aria-label={`Open ${message.user ? 'your' : persona?.name ?? message.author} profile`}>{message.user ? profileAvatar : persona?.avatar ?? 'N!'}</button>
          <div><div className="message-name"><b>{message.user ? profileName || 'You' : persona?.name ?? message.author}</b>{persona && <span>{persona.kind === 'bot' ? 'BOT · ' : ''}{persona.role}</span>}<time>{message.time}</time><button className="quote-message" onClick={() => setReplyToId(message.id)} title={`Reply to ${message.user ? profileName || 'You' : persona?.name ?? message.author}`} aria-label={`Reply to ${message.user ? profileName || 'You' : persona?.name ?? message.author}`}><Reply /></button></div>
            {quoted && <button className="quoted-message" onClick={() => document.getElementById(`message-${quoted.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><b>{quoted.user ? profileName || 'You' : quoted.author}</b><span>{quoted.storyTitle || quoted.text}</span></button>}
            {message.storyId && message.storyTitle && <button className="shared-story-message" onClick={() => onOpenStory(message.storyId)}><small>SHARED FROM TL;DR</small><b>{message.storyTitle}</b><span>open in the feed →</span></button>}{message.text && <p>{message.text}</p>}{message.sources && message.sources.length > 0 && <div className="message-sources"><small>PUBLIC SOURCES USED</small>{message.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${message.id}-${source.id}`}><b>{hostname(source.url)}</b><span>{source.title}</span></a>)}</div>}
          </div>
        </div>
      })}{typingPersona && <div className="message typing-message" aria-live="polite"><button className="message-avatar" style={{ background: typingPersona.color }} tabIndex={-1}>{typingPersona.avatar}</button><div><div className="message-name"><b>{typingPersona.name}</b></div>{typing?.activity === 'searching' ? <div className="searching-status"><Search /> searching...</div> : typing?.activity === 'reading' ? <div className="searching-status"><Search /> checking the original...</div> : <div className="typing-dots" aria-label={`${typingPersona.name} is typing`}><i /><i /><i /></div>}</div></div>}<div ref={messagesEnd} /></div>
      <div className="compose-wrap">{mentionOptions.length > 0 && <div className="mention-menu"><small>MENTION A COWORKER</small>{mentionOptions.map((persona) => <button key={persona.id} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(persona)}><i style={{ background: persona.color }}>{persona.avatar}</i><span><b>@{persona.name}</b><small>{persona.role}</small></span></button>)}</div>}{replyingTo && <div className="compose-reply"><Reply /><span><b>replying to {replyingTo.author}</b><small>{replyingTo.storyTitle || replyingTo.text}</small></span><button onClick={() => setReplyToId('')} aria-label="Cancel reply"><X /></button></div>}{pendingStory && <div className="compose-attachment"><Newspaper /><span><small>ATTACHED FROM TL;DR</small><b>{pendingStory.title}</b></span><button onClick={onRemovePending} aria-label="Remove attached story"><X /></button></div>}<div className="chat-compose"><Plus /><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && mentionOptions.length === 0) { event.preventDefault(); onSend() } }} placeholder={pendingStory ? 'add a thought, or send the attachment as it is…' : busy ? 'jump in anytime, the room will recalculate…' : 'say something... type @ to pull someone in'} /><button onClick={onSend} aria-label={pendingStory ? 'Send attached story' : 'Send message'}><Send /></button></div></div>
    </main>
    {profilePersonaId && <CoworkerProfile persona={personas.find((persona) => persona.id === profilePersonaId)!} onClose={() => setProfilePersonaId('')} onDm={(persona) => { setProfilePersonaId(''); onOpenDm(persona) }} />}
  </div>
}

function CoworkerProfile({ persona, onClose, onDm }: { persona: Persona; onClose: () => void; onDm: (persona: Persona) => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const closeOnOutsideClick = (event: PointerEvent) => { if (!cardRef.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('pointerdown', closeOnOutsideClick)
    return () => { window.removeEventListener('keydown', closeOnEscape); window.removeEventListener('pointerdown', closeOnOutsideClick) }
  }, [onClose])
  return <div className="coworker-profile-layer"><div className="coworker-profile" ref={cardRef} style={{ '--profile-color': persona.color } as React.CSSProperties} role="dialog" aria-modal="true" aria-label={`${persona.name}'s profile`}><div className="coworker-profile-banner"><button onClick={onClose} aria-label="Close profile"><X /></button></div><div className="coworker-profile-body"><i className="coworker-profile-avatar" style={{ background: persona.color }}>{persona.avatar}</i><div className="coworker-profile-name"><b>{persona.name}</b>{persona.kind === 'bot' && <span>BOT</span>}<small>{persona.handle}</small></div><span className="profile-flare">{persona.profileFlare || persona.role}</span><div className="persona-self-bio">{(persona.profileLines?.length ? persona.profileLines : [persona.selfBio]).map((line) => <p key={line}>{line}</p>)}{persona.profileLinks?.map((link) => link.url ? <a href={link.url} target="_blank" rel="noreferrer" key={link.label}>{link.label} ↗</a> : <span className="profile-link-muted" key={link.label}>{link.label}</span>)}{!persona.profileLinks?.length && persona.profileLink && <a href={persona.profileLink.url} target="_blank" rel="noreferrer">{persona.profileLink.label}</a>}</div><button className="profile-dm" onClick={() => onDm(persona)}><MessageCircle /> Message {persona.name}</button></div></div></div>
}

type GraphNode = { id: string; name: string; category: string; color: string; val: number; story: Story; layoutRevision: number }
type GraphLink = { source: string | GraphNode; target: string | GraphNode; label: string; reason: string; score: number }
const graphEndpointId = (endpoint: GraphLink['source']) => typeof endpoint === 'string' ? endpoint : endpoint.id
const graphRelationValues = (story: Story) => ({
  events: story.annotation?.eventKey ? [story.annotation.eventKey] : [],
  concerns: story.annotation?.concerns ?? [],
  actors: story.annotation?.actors ?? [],
  technologies: (story.annotation?.technologies ?? []).filter((value) => value.toLowerCase() !== 'ai'),
  domains: story.annotation?.domains ?? [],
  groups: story.annotation?.affectedGroups ?? [],
  policy: story.annotation?.policyIssues ?? [],
})

function ConnectionsApp({ availableStories, theme, onOpenStory }: { availableStories: Story[]; theme: ThemeId; onOpenStory: (story: Story) => void }) {
  const [selectedId, setSelectedId] = useState(availableStories[0]?.id ?? '')
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set())
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [hideIsolated, setHideIsolated] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [layoutRevision, setLayoutRevision] = useState(0)
  const graphWrap = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const fitPending = useRef(true)
  const [graphSize, setGraphSize] = useState({ width: 760, height: 560 })
  const categories = useMemo(() => [...new Set(availableStories.map((story) => story.annotation?.primaryCategory ?? 'uncategorized'))], [availableStories])
  const selected = availableStories.find((story) => story.id === selectedId) ?? availableStories[0]
  const edges = useMemo<GraphLink[]>(() => availableStories.flatMap((from, index) => availableStories.slice(index + 1).flatMap((to) => {
    const left = graphRelationValues(from); const right = graphRelationValues(to)
    const shared = (key: keyof typeof left) => left[key].filter((value) => right[key].some((other) => other.toLowerCase() === value.toLowerCase()))
    const matches = { events: shared('events'), concerns: shared('concerns'), actors: shared('actors'), technologies: shared('technologies'), domains: shared('domains'), groups: shared('groups'), policy: shared('policy') }
    const score = matches.events.length * 9 + matches.concerns.length * 5 + matches.actors.length * 4 + matches.policy.length * 4 + matches.technologies.length * 3 + matches.domains.length * 3 + matches.groups.length * 3
    if (score < 5) return []
    const pair = Object.entries(matches).find(([, values]) => values.length) as [string, string[]] | undefined
    const label = pair?.[1][0] ?? 'related development'
    const kind = pair?.[0] === 'events' ? 'same developing event' : pair?.[0] === 'concerns' ? 'shared concern' : `shared ${pair?.[0] ?? 'context'}`
    return [{ source: from.id, target: to.id, label, reason: `${kind}: ${label}`, score } satisfies GraphLink]
  })).sort((a, b) => b.score - a.score).slice(0, 110), [availableStories])
  const connectedIds = useMemo(() => new Set(edges.flatMap((edge) => [graphEndpointId(edge.source), graphEndpointId(edge.target)])), [edges])
  const visibleStories = useMemo(() => availableStories.filter((story) => !hiddenCategories.has(story.annotation?.primaryCategory ?? 'uncategorized') && !hiddenIds.has(story.id) && (!hideIsolated || connectedIds.has(story.id))), [availableStories, connectedIds, hiddenCategories, hiddenIds, hideIsolated])
  const visibleIds = useMemo(() => new Set(visibleStories.map((story) => story.id)), [visibleStories])
  const graphData = useMemo(() => ({
    nodes: visibleStories.map((story) => ({ id: story.id, name: story.title, category: story.annotation?.primaryCategory ?? 'uncategorized', color: categoryColors[story.annotation?.primaryCategory ?? 'uncategorized'] ?? categoryColors.uncategorized, val: 6, story, layoutRevision } satisfies GraphNode)),
    links: edges.filter((edge) => visibleIds.has(graphEndpointId(edge.source)) && visibleIds.has(graphEndpointId(edge.target))).map((edge) => ({ ...edge })),
  }), [edges, layoutRevision, visibleIds, visibleStories])
  const selectedEdges = edges.filter((edge) => graphEndpointId(edge.source) === selected?.id || graphEndpointId(edge.target) === selected?.id)
  const fitGraph = (duration = 450) => graphRef.current?.zoomToFit(duration, 65)
  const resetLayout = () => {
    setPinnedIds(new Set())
    fitPending.current = true
    setLayoutRevision((revision) => revision + 1)
  }

  useEffect(() => {
    if (!graphWrap.current) return
    let settleTimer = 0
    const resize = new ResizeObserver(([entry]) => {
      setGraphSize({ width: Math.max(320, entry.contentRect.width), height: Math.max(420, entry.contentRect.height) })
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => fitGraph(250), 180)
    })
    resize.observe(graphWrap.current)
    return () => { resize.disconnect(); window.clearTimeout(settleTimer) }
  }, [])
  useEffect(() => { fitPending.current = true }, [graphData])
  useEffect(() => {
    localStorage.setItem('contexta-connection-edges', JSON.stringify(edges.map((edge) => ({ from: graphEndpointId(edge.source), to: graphEndpointId(edge.target), label: edge.label, reason: edge.reason, score: edge.score }))))
  }, [edges])

  return <div className="connections-app graph-3d-mode">
    <header><div><small>THE MONTH AS A SPACE</small><h2>turn it around. keep your place.</h2><p>Click to inspect. Drag a node to pin it. Drag empty space to orbit, right-drag to pan, and scroll to zoom.</p></div><span>{graphData.nodes.length} visible · {graphData.links.length} links</span></header>
    <div className="graph-filters"><button onClick={() => fitGraph()}>fit graph</button><button onClick={resetLayout}>reset layout</button><button className={hideIsolated ? 'active' : ''} onClick={() => setHideIsolated((value) => !value)}>hide isolated</button>{categories.map((category) => <button key={category} className={hiddenCategories.has(category) ? 'hidden' : ''} style={{ '--category': categoryColors[category] ?? categoryColors.uncategorized } as React.CSSProperties} onClick={() => setHiddenCategories((current) => toggleSet(current, category))}><i />{categoryLabel(category)}</button>)}{hiddenIds.size > 0 && <button onClick={() => setHiddenIds(new Set())}>show {hiddenIds.size} hidden</button>}</div>
    <div className="connection-layout"><div className="connection-network-3d" ref={graphWrap}>{graphData.nodes.length ? <><ForceGraph3D<GraphNode, GraphLink> ref={graphRef} width={graphSize.width} height={graphSize.height} graphData={graphData} backgroundColor={theme === 'night' ? '#111522' : '#f7fbff'} showNavInfo={false} controlType="orbit" enableNodeDrag enableNavigationControls enablePointerInteraction warmupTicks={120} cooldownTicks={0} d3AlphaDecay={.08} d3VelocityDecay={.45} nodeLabel={(node) => `<b>${escapeHtml(node.name)}</b><br>${escapeHtml(categoryLabel(node.category))}${pinnedIds.has(node.id) ? '<br>pinned' : ''}`} nodeColor={(node) => node.id === selectedId ? '#ffd34f' : node.color} nodeVal={(node) => node.id === selectedId ? 12 : node.val} nodeRelSize={5} nodeOpacity={.96} nodeResolution={20} linkLabel="reason" linkColor={() => theme === 'night' ? '#98a5c4' : '#8b98b5'} linkOpacity={theme === 'night' ? .34 : .24} linkWidth={(link) => Math.min(2.6, .35 + link.score / 8)} linkDirectionalParticles={(link) => link.score >= 9 ? 1 : 0} linkDirectionalParticleWidth={1.4} onNodeClick={(node) => setSelectedId(String(node.id))} onNodeDragEnd={(node) => { node.fx = node.x; node.fy = node.y; node.fz = node.z; setPinnedIds((current) => new Set(current).add(String(node.id))); setSelectedId(String(node.id)) }} onEngineStop={() => { if (fitPending.current) { fitPending.current = false; fitGraph(500) } }} /></> : <div className="graph-empty">waiting for the live news map…</div>}<div className="graph-help">drag node = pin · drag space = orbit · right-drag = pan · wheel = zoom</div></div>
      <aside><small>SELECTED DEVELOPMENT</small><h3>{selected?.title ?? 'Pick a node'}</h3>{selected && <><span className="selected-category" style={{ '--category': categoryColors[selected.annotation?.primaryCategory ?? 'uncategorized'] } as React.CSSProperties}>{categoryLabel(selected.annotation?.primaryCategory ?? 'uncategorized')}</span>{pinnedIds.has(selected.id) && <span className="pin-status">pinned where you left it</span>}<p className="connection-summary">{selected.annotation?.rationale || (selectedEdges.length ? `${selectedEdges.length} evidence-backed relationships are visible.` : 'No strong semantic edge was found for this development.')}</p><div className="connection-originals"><b>OPEN ORIGINAL COVERAGE</b>{selected.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{source.url}</a>)}</div><div className="edge-reasons"><b>WHY THE LINES EXIST</b>{selectedEdges.slice(0, 8).map((edge) => <button key={`${String(edge.source)}:${String(edge.target)}`} title={edge.reason} onClick={() => { const other = graphEndpointId(edge.source) === selected.id ? graphEndpointId(edge.target) : graphEndpointId(edge.source); setSelectedId(other) }}><span>{edge.label}</span><small>{edge.reason}</small></button>)}</div><div className="graph-selection-actions"><button onClick={() => onOpenStory(selected)}>view in TL;DR</button><button onClick={() => { setHiddenIds((current) => new Set(current).add(selected.id)); setSelectedId('') }}>hide this node</button></div></>}</aside>
    </div>
  </div>
}

export function ReportsApp({ availableStories, storyIds, setStoryIds, savedIds, title, setTitle, note, setNote, personas }: { availableStories: Story[]; storyIds: Set<string>; setStoryIds: React.Dispatch<React.SetStateAction<Set<string>>>; savedIds: Set<string>; title: string; setTitle: (value: string) => void; note: string; setNote: (value: string) => void; personas: Persona[] }) {
  const [view, setView] = useState<'report' | 'saved' | 'archive' | 'setup'>(() => title ? 'report' : 'setup')
  const [topic, setTopic] = useState('')
  const [insightBrief, setInsightBrief] = useState('')
  const [helperIds, setHelperIds] = useState<Set<string>>(() => new Set(personas.filter((persona) => persona.active).map((persona) => persona.id)))
  const [focusIds, setFocusIds] = useState<Set<string>>(() => new Set(storyIds))
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState('')
  const [reportMode, setReportMode] = useState<'read' | 'edit'>('read')
  const selected = availableStories.filter((story) => storyIds.has(story.id))
  const savedStories = availableStories.filter((story) => savedIds.has(story.id))
  const candidates = availableStories.filter((story) => savedIds.has(story.id) || storyIds.has(story.id))
  const setupStories = candidates.length ? candidates : availableStories
  const createReport = async () => {
    if (!topic.trim() || focusIds.size === 0 || generating) return
    setGenerating(true)
    setGenerationError('')
    const evidence = availableStories.filter((story) => focusIds.has(story.id))
    const helpers = personas.filter((persona) => helperIds.has(persona.id))
    try {
      const result = await draftReport(topic.trim(), insightBrief.trim(), evidence, helpers)
      setNote(result.text)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'The live AI service is unavailable.')
      setGenerating(false)
      return
    }
    setTitle(topic.trim())
    setStoryIds(new Set(focusIds))
    setReportMode('read')
    setView('report')
    setGenerating(false)
  }
  const beginNew = () => { setTitle(''); setTopic(''); setInsightBrief(''); setFocusIds(new Set(storyIds)); setView('setup') }

  return <div className="reports-app"><aside className="file-tree"><div className="channel-heading">FILES</div><button className={view === 'report' || view === 'setup' ? 'active' : ''} onClick={() => setView(title ? 'report' : 'setup')}><FolderOpen /> reports <b>{selected.length}</b></button><button className={view === 'saved' ? 'active' : ''} onClick={() => setView('saved')}><Bookmark /> saved <b>{savedIds.size}</b></button><button className={view === 'archive' ? 'active' : ''} onClick={() => setView('archive')}><Archive /> archive</button><button className="new-report-button" onClick={beginNew}><Plus /> new report</button></aside><main className="report-editor">
    {view === 'setup' && <div className="report-setup"><small>NEW_REPORT.WIZ</small><h2>what are we trying to understand?</h2><p>Pick the evidence and synthetic lenses. Qwen will draft only from those records.</p><label><span>REPORT TOPIC</span><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. how agents are entering public-sector governance" /></label><fieldset><legend>WHO SHOULD HELP?</legend><div className="helper-grid">{personas.filter((persona) => persona.active).map((persona) => <button type="button" key={persona.id} className={helperIds.has(persona.id) ? 'selected' : ''} onClick={() => setHelperIds((current) => toggleSet(current, persona.id))}><i style={{ background: persona.color }}>{persona.avatar}</i><span><b>{persona.name}</b><small>{persona.role}</small></span>{helperIds.has(persona.id) && <Check />}</button>)}</div></fieldset><fieldset><legend>WHICH NEWS SHOULD IT FOCUS ON?</legend><div className="focus-stories">{setupStories.map((story) => <label key={story.id}><input type="checkbox" checked={focusIds.has(story.id)} onChange={() => setFocusIds((current) => toggleSet(current, story.id))} /><span><b>{story.title}</b><small>{story.period} · {story.region} {savedIds.has(story.id) ? '· saved' : ''}</small></span></label>)}</div></fieldset><label><span>WHAT INSIGHT SHOULD THEY DRAW OUT?</span><textarea value={insightBrief} onChange={(event) => setInsightBrief(event.target.value)} placeholder="your angle, concern, or agenda — this is explicit, not secretly inferred" /></label><div className="wizard-note"><LockKeyhole /> Only the evidence selected here is sent to the model. Room history is not included.</div>{generationError && <div className="wizard-note"><TriangleAlert /> {generationError}</div>}<button className="create-report-button" disabled={!topic.trim() || focusIds.size === 0 || generating} onClick={createReport}><Sparkles /> {generating ? 'drafting with Qwen…' : 'create grounded report'}</button></div>}
    {view === 'saved' && <div className="saved-view"><div className="report-toolbar"><span>SAVED_ITEMS</span><small>{savedStories.length} records</small></div><h2>saved from the newswire</h2>{savedStories.length === 0 ? <div className="empty-report"><Bookmark /><b>nothing saved yet</b><span>Save a newswire item and it will appear here.</span></div> : savedStories.map((story) => <article key={story.id}><div><small>{story.period} · {story.region}</small><h3>{story.title}</h3></div><button className={storyIds.has(story.id) ? 'selected' : ''} onClick={() => setStoryIds((current) => toggleSet(current, story.id))}>{storyIds.has(story.id) ? <Check /> : <Plus />}{storyIds.has(story.id) ? 'included' : 'add to report'}</button></article>)}</div>}
    {view === 'archive' && <div className="empty-report archive-empty"><Archive /><b>archive is empty</b><span>Finished reports will live here after persistence is connected.</span></div>}
    {view === 'report' && title && <><div className="report-toolbar"><span>WORKING_REPORT.MD</span><div><button onClick={() => setReportMode((mode) => mode === 'read' ? 'edit' : 'read')}>{reportMode === 'read' ? 'edit markdown' : 'read report'}</button><button onClick={beginNew}><Plus /> new</button><button onClick={() => navigator.clipboard?.writeText(note)}><Save /> copy markdown</button></div></div><input className="report-title" value={title} onChange={(event) => setTitle(event.target.value)} /><p className="report-kicker">Grounded draft · {selected.length} selected sources · verify claims against the originals.</p>{reportMode === 'read' ? <MarkdownView markdown={note} /> : <label className="report-note report-note-full"><span>MARKDOWN SOURCE / EDITABLE</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="grounded report draft" /></label>}<details className="report-evidence"><summary>Evidence used ({selected.length})</summary><div className="report-stories">{selected.map((story) => <section key={story.id}><small>{story.period} · {story.region}</small><h3>{story.title}</h3><p>{story.post[0]}</p><a href={story.sources[0].url} target="_blank" rel="noopener noreferrer">{story.sources[0].url}</a></section>)}</div></details></>}
  </main></div>
}

function MarkdownView({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n')
  return <article className="markdown-report">{lines.map((line, index) => {
    const key = `${index}-${line.slice(0, 20)}`
    if (line.startsWith('### ')) return <h3 key={key}>{renderInline(line.slice(4))}</h3>
    if (line.startsWith('## ')) return <h2 key={key}>{renderInline(line.slice(3))}</h2>
    if (line.startsWith('# ')) return <h1 key={key}>{renderInline(line.slice(2))}</h1>
    if (/^[-*] /.test(line)) return <div className="markdown-list-item" key={key}><span>•</span><p>{renderInline(line.slice(2))}</p></div>
    if (/^\d+\. /.test(line)) return <div className="markdown-list-item" key={key}><span>{line.match(/^\d+/)?.[0]}.</span><p>{renderInline(line.replace(/^\d+\. /, ''))}</p></div>
    if (!line.trim()) return <div className="markdown-space" key={key} />
    return <p key={key}>{renderInline(line)}</p>
  })}</article>
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\[EVIDENCE [^\]]+\])/g).filter(Boolean).map((part, index) => part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('[EVIDENCE ') ? <code key={index}>{part}</code> : part)
}

function NotesApp({ notes, setNotes, activeId, setActiveId, onShare }: { notes: PrivateNote[]; setNotes: React.Dispatch<React.SetStateAction<PrivateNote[]>>; activeId: string; setActiveId: (id: string) => void; onShare: (note: PrivateNote) => void }) {
  const active = notes.find((note) => note.id === activeId) ?? notes[0]
  const addNote = () => { const id = `note-${Date.now()}`; setNotes((current) => [{ id, title: 'new note', topic: 'inbox', body: '', updatedAt: 'just now' }, ...current]); setActiveId(id) }
  const updateNote = (patch: Partial<PrivateNote>) => active && setNotes((current) => current.map((note) => note.id === active.id ? { ...note, ...patch, updatedAt: 'just now' } : note))

  const topics = [...new Set(notes.map((note) => note.topic || 'inbox'))]
  return <div className="notes-app"><aside><div className="notes-toolbar"><b>POST-IT</b><button onClick={addNote}><Plus /> new</button></div>{topics.map((topic) => <section className="note-topic" key={topic}><h3>{topic}</h3>{notes.filter((note) => (note.topic || 'inbox') === topic).map((note) => <button key={note.id} className={active?.id === note.id ? 'active' : ''} onClick={() => setActiveId(note.id)}><b>{note.title || 'untitled'}</b><span>{note.body || 'empty note'}</span><small>{note.updatedAt}</small></button>)}</section>)}</aside><main>{active ? <><div className="note-actions"><span><LockKeyhole /> stays on this device</span><button onClick={() => onShare(active)}><Share2 /> drop into chat</button></div><label className="note-topic-input"><span>TOPIC</span><input value={active.topic} onChange={(event) => updateNote({ topic: event.target.value || 'inbox' })} placeholder="inbox" /></label><input value={active.title} onChange={(event) => updateNote({ title: event.target.value })} aria-label="Note title" /><textarea value={active.body} onChange={(event) => updateNote({ body: event.target.value })} placeholder="stick a thought here..." /></> : <div className="empty-report"><StickyNote /><b>no post-its</b><button onClick={addNote}>make one</button></div>}</main></div>
}

function SourcesApp({ availableStories }: { availableStories: Story[] }) {
  const sources = Array.from(new Map(availableStories.flatMap((story) => story.sources).map((source) => [hostname(source.url), source])).values())
  return <div className="sources-app"><div className="source-intro"><ShieldCheck /><div><h2>where did these links come from?</h2><p>TL;DR pulls coverage URLs from the live GDELT index plus Google News and Bing News RSS. We extract the URL, keep its full hostname visible, remove obvious duplicate headlines, and attach it to the item you saw.</p></div></div><div className="source-caution"><TriangleAlert /><div><b>Verify every link and claim before trusting it.</b><span>Being listed here does not make a page true, safe, primary, independent, or well reported. Open the original, check who published it, compare dates, inspect redirects, and corroborate anything important elsewhere.</span></div></div><div className="source-table"><div className="source-table-head"><span>EXTRACTED URL</span><span>LABEL</span><span>TRUST?</span></div>{sources.map((source) => <div key={source.url}><span><b>{hostname(source.url)}</b><code>{source.url}</code></span><span>{source.tier}</span><span className="verify-yourself">verify it ↗</span></div>)}</div></div>
}

function SettingsApp({ selectedRegions, setSelectedRegions, theme, setTheme, systemVolume, setSystemVolume }: { selectedRegions: string[]; setSelectedRegions: (regions: string[]) => void; theme: ThemeId; setTheme: (theme: ThemeId) => void; systemVolume: number; setSystemVolume: (volume: number) => void }) {
  return <div className="settings-app"><section><div className="settings-heading"><Globe2 /><div><h2>your map</h2><p>Choose what feels local to you. You can still see everything.</p></div></div><div className="region-grid">{regions.map((region) => <button key={region} className={selectedRegions.includes(region) ? 'selected' : ''} onClick={() => setSelectedRegions(toggleArray(selectedRegions, region))}><span>{region}</span>{selectedRegions.includes(region) && <Check />}</button>)}</div></section><section><div className="settings-heading"><Palette /><div><h2>desktop look</h2><p>Pick whatever makes this strange little office feel like yours.</p></div></div><div className="theme-grid">{([{ id: 'cloud', name: 'cloud desk' }, { id: 'strawberry', name: 'strawberry milk' }, { id: 'night', name: 'after midnight' }] as { id: ThemeId; name: string }[]).map((item) => <button key={item.id} className={`${item.id} ${theme === item.id ? 'selected' : ''}`} onClick={() => setTheme(item.id)}><i><Image /></i><span>{item.name}</span>{theme === item.id && <Check />}</button>)}</div></section><section><div className="settings-heading"><Volume2 /><div><h2>sound</h2><p>Adjust interface feedback sounds.</p></div></div><div className="volume-settings"><label><span><b>SYSTEM SOUND</b><small>button response sounds</small></span><input type="range" min="0" max="100" step="1" value={Math.round(systemVolume * 100)} onChange={(event) => setSystemVolume(Number(event.target.value) / 100)} aria-label="System sound volume" /><output>{Math.round(systemVolume * 100)}%</output></label></div></section><section className="account-box"><UserRound /><div><b>ACCOUNT & SYNC</b><span>Your appearance and profile are saved in this browser for now.</span><small>Click your profile icon in Chat or the taskbar to change your display name and icon.</small></div></section><section className="provider-box"><Bot /><div><b>MODEL PROVIDER</b><span>Cloudflare Workers AI · Qwen3</span><small>Live requests go through the local server. The API token never enters the browser bundle.</small></div></section></div>
}

function ShopApp() {
  return <div className="shop-app pixel-cat-shop"><div className="cat-house-stage"><img src={catHouse} alt="A glowing pixel-art wooden cat house covered in vines" /><div className="cat-house-welcome"><b>Thank you<br />for your support!</b><span>Meet Yionna at:</span><div className="cat-house-socials"><a href="https://yionna.substack.com" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Newspaper /><span>Substack</span></a><a href="https://github.com/yionna/contexta" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><GitFork /><span>GitHub</span></a></div><a className="cat-house-coffee" href="https://buymeacoffee.com/yionna" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee /> Buy me a coffee</a></div></div></div>
}

function DesktopCat({ mood, onPet, onFeed }: { mood: CatMood; onPet: () => void; onFeed: () => void }) {
  const [position, setPosition] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('contexta-cat-position') ?? 'null'); if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return { x: Math.min(Math.max(8, value.x), Math.max(8, window.innerWidth - 86)), y: Math.min(Math.max(8, value.y), Math.max(8, window.innerHeight - 98)) } } catch { /* use the corner */ }
    return { x: Math.max(8, window.innerWidth - 100), y: Math.max(8, window.innerHeight - 120) }
  })
  const positionRef = useRef(position)
  const drag = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null)
  useEffect(() => { positionRef.current = position }, [position])
  useEffect(() => {
    const keepOnScreen = () => setPosition((current) => ({ x: Math.min(current.x, Math.max(8, window.innerWidth - 86)), y: Math.min(current.y, Math.max(8, window.innerHeight - 98)) }))
    window.addEventListener('resize', keepOnScreen)
    return () => window.removeEventListener('resize', keepOnScreen)
  }, [])
  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, originX: position.x, originY: position.y, moved: false }
  }
  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x; const dy = event.clientY - drag.current.y
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.current.moved = true
    const next = { x: Math.min(Math.max(8, drag.current.originX + dx), Math.max(8, window.innerWidth - 86)), y: Math.min(Math.max(8, drag.current.originY + dy), Math.max(8, window.innerHeight - 98)) }
    positionRef.current = next
    setPosition(next)
  }
  const endDrag = () => {
    const wasMoved = drag.current?.moved
    drag.current = null
    localStorage.setItem('contexta-cat-position', JSON.stringify(positionRef.current))
    if (!wasMoved) onPet()
  }
  const status = mood === 'eating' ? 'cronch cronch' : mood === 'sleeping' ? 'zzzz...' : mood === 'startled' ? 'you woke me up?!' : mood === 'angry' ? 'excuse me. i exist.' : mood === 'playful' ? 'play mode unlocked' : mood === 'butterfly' ? 'tiny airborne suspect spotted' : mood === 'cool' ? 'too cool for the taskbar' : 'wandering with intent'
  return <div className={`desktop-cat cat-${mood}`} style={{ left: position.x, top: position.y }}><span className="cat-speech" key={mood} aria-live="polite">{status}</span><button className="cat-body" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null }} aria-label="Drag or play with the desktop cat"><span className="cat-sprite" style={{ backgroundImage: `url(${catStates})` }} /></button><div className="cat-hover-actions"><button onClick={onPet}>play</button><button onClick={onFeed}>feed</button></div></div>
}

function DesktopSound({ systemVolume }: { systemVolume: number }) {
  const clickAudioRef = useRef<AudioContext | null>(null)
  useEffect(() => {
    const playClick = () => {
      if (systemVolume <= 0) return
      const context = clickAudioRef.current ?? new AudioContext(); clickAudioRef.current = context
      void context.resume()
      const oscillator = context.createOscillator(); const gain = context.createGain(); const now = context.currentTime
      oscillator.type = 'square'; oscillator.frequency.setValueAtTime(720, now); oscillator.frequency.exponentialRampToValueAtTime(520, now + .045); gain.gain.setValueAtTime(.022 * systemVolume, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .055)
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + .055)
    }
    const activate = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('button,a,summary,[role="button"]')) playClick()
    }
    document.addEventListener('pointerdown', activate, true)
    return () => document.removeEventListener('pointerdown', activate, true)
  }, [systemVolume])
  useEffect(() => () => { void clickAudioRef.current?.close() }, [])
  return null
}

function Onboarding({ selected, setSelected, onContinue }: { selected: string[]; setSelected: (value: string[]) => void; onContinue: () => void }) {
  return <div className="onboarding-backdrop"><div className="onboarding-window"><div className="onboarding-titlebar"><span>LIL_BOT_SAYS_HI.EXE</span><Bot /></div><div className="onboarding-art"><div className="guide-bot-face">:?</div><span>LIL BOT / FRONT DESK</span></div><div className="onboarding-copy"><small>LIL BOT HERE. ONE QUICK THING.</small><h1>which parts of the world should feel close by?</h1><p>I’ll open TL;DR with a month of fresh links. They are leads, not truth—please check the originals before believing anything dramatic.</p><div className="onboarding-regions">{regions.map((region) => <button key={region} className={selected.includes(region) ? 'selected' : ''} onClick={() => setSelected(toggleArray(selected, region))}>{selected.includes(region) ? <Check /> : <Plus />}{region}</button>)}</div><button className="continue-button" onClick={onContinue}>show me TL;DR <span>→</span></button><div className="onboarding-foot">You can ask me what anything means. The cat is no help.</div></div></div></div>
}

function toggleSet(current: Set<string>, value: string) { const next = new Set(current); if (next.has(value)) next.delete(value); else next.add(value); return next }
function toggleArray(current: string[], value: string) { return current.includes(value) ? current.filter((item) => item !== value) : [...current, value] }

export default App
