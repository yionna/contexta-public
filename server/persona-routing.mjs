const socialRepairPatterns = [
  /\b(?:your|that)\s+(?:tone|attitude|silence)\b/i,
  /\byou(?:'re| are| were)?(?: being)?\s+(?:rude|cold|silent|dismissive)\b/i,
  /\byou\s+(?:sound|sounded|seem|seemed|went)\s+(?:rude|cold|silent|dismissive)\b/i,
  /\b(?:why\s+(?:are|were|did)\s+you|you)\s+(?:ignore|ignored|ignoring|ghost|ghosted|ghosting|leave|left)\s+me\b/i,
  /\bleft\s+me\s+hanging\b/i,
  /\b(?:the|what\s+an)\s+attitude\s*[.!?]*$/i,
  /^(?:hey,?\s*)?(?:chill|calm down)(?:\s+(?:bro|dude|man))?[.!?\s]*$/i,
  /^(?:u|you)\s+(?:ok|okay|alright|good)\??$/i,
]

const personaFallbacks = {
  mika: 'well, that reply fell through the floor. give me the question once more.',
  ren: 'that response failed somewhere between input and output. try me once more.',
  sora: 'apparently silence won that round. ask me again.',
  jules: 'oof, that reply missed the market entirely 😅 try me once more?',
  'lil bot': 'oops, lost that one behind the taskbar. try me again?',
}

const personaRepairFallbacks = {
  mika: 'yeah, fair. i was forcing the bit instead of listening.',
  ren: 'fair. i answered around you instead of answering you.',
  sora: 'Fair. I was pushing the framing after you had already rejected it.',
  jules: 'fair, i priced the bit before listening to you 😅',
  'lil bot': 'yeah, that was me getting stuck on the wrong thing. resetting.',
}

export function stableBucket(value, buckets) {
  let hash = 2166136261
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0) % buckets
}

export const isSocialRepairMessage = (message) => socialRepairPatterns.some((pattern) => pattern.test(String(message)))

export function isMissedSocialRepair(text) {
  const normalized = String(text).toLowerCase().replace(/[^a-z0-9'\s]/g, '').replace(/\s+/g, ' ').trim()
  return /^(?:ok|okay|fine|sure|noted|right|cool|wow|huh|what|pass)$/.test(normalized)
}

const normalizeReply = (value) => String(value).toLowerCase().replace(/^[^:]{1,40}:\s*/, '').replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()

export function isRepeatedReply(text, currentMessage, recentMessages = []) {
  const candidate = normalizeReply(text)
  if (!candidate) return true
  const previous = [currentMessage, ...recentMessages].map(normalizeReply).filter(Boolean)
  if (previous.includes(candidate)) return true
  // Smaller models sometimes splice two visible lines into one reply. Reject a
  // copied clause even when extra transcript text was glued before or after it.
  if (previous.some((entry) => entry.split(' ').length >= 4 && (candidate.includes(entry) || entry.includes(candidate)))) return true
  const words = new Set(candidate.split(' ').filter((word) => word.length > 2))
  if (words.size < 6) return false
  return previous.some((entry) => {
    const other = new Set(entry.split(' ').filter((word) => word.length > 2))
    if (other.size < 6) return false
    const shared = [...words].filter((word) => other.has(word)).length
    return shared / Math.min(words.size, other.size) >= .86
  })
}

const clip = (value, size) => typeof value === 'string' ? value.trim().slice(0, size) : ''

// Conversation history is different from configuration lists: the newest turns
// are the ones that must survive a limit. Keep a structured shape so quotations
// and speaker identity are not flattened away before the model sees them.
export function cleanRecentMessages(value, count = 16) {
  if (!Array.isArray(value)) return []
  return value.slice(-count).map((item) => {
    if (typeof item === 'string') {
      const separator = item.indexOf(':')
      return {
        author: separator > 0 ? clip(item.slice(0, separator), 80) : 'unknown',
        text: clip(separator > 0 ? item.slice(separator + 1) : item, 700),
      }
    }
    return {
      author: clip(item?.author, 80) || 'unknown',
      personaId: clip(item?.personaId, 80),
      text: clip(item?.text, 700),
      replyToAuthor: clip(item?.replyToAuthor, 80),
      replyToText: clip(item?.replyToText, 400),
    }
  }).filter((item) => item.text)
}

export function formatRecentMessages(messages) {
  return messages.map((item) => {
    const reply = item.replyToAuthor && item.replyToText
      ? ` (replying to ${item.replyToAuthor}: “${item.replyToText}”)`
      : ''
    return `${item.author}${reply}: ${item.text}`
  }).join('\n')
}

const comparable = (value) => normalizeReply(value).replace(/^@/, '')

// Some chat-tuned models occasionally print the serialized speaker line before
// their answer (for example `you@Lil Bot explain`). Remove only leading lines
// that can be matched back to an actual current/recent turn.
export function stripConversationEcho(text, currentMessage, recentMessages = []) {
  const escapedCurrent = String(currentMessage).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutGluedCurrent = escapedCurrent
    ? String(text).replace(new RegExp(`^(?:you\s*[:@-]?\s*)?${escapedCurrent}\s*(?:\\r?\\n|(?=[A-Z]))`, 'i'), '')
    : String(text)
  const lines = withoutGluedCurrent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const known = [currentMessage, ...recentMessages.map((item) => typeof item === 'string' ? item : item?.text)].map(comparable).filter(Boolean)
  while (lines.length > 1) {
    const line = comparable(lines[0])
    const withoutSpeaker = comparable(lines[0].replace(/^(?:you|mika|ren|sora|jules|lil\s*bot)\s*[:@-]?\s*/i, ''))
    const copied = known.some((entry) => {
      const candidate = withoutSpeaker || line
      return candidate.split(' ').length >= 2 && (entry === candidate || entry.includes(candidate) || candidate.includes(entry))
    })
    if (!copied) break
    lines.shift()
  }
  return lines.join('\n').trim()
}

// Keep the visible voice stable even when a smaller chat model drifts. This is
// deliberately surface-level: content and opinions still come from the model.
export function applyPersonaSurfaceStyle(name, text, expressionBucket = 7) {
  const persona = String(name).trim().toLowerCase()
  const escapedName = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let styled = String(text)
    .replace(new RegExp(`^\\s*\\(\\s*(?:\\*\\*)?@?${escapedName}(?:\\*\\*)?\\s*[:：]\\s*([\\s\\S]*?)\\s*\\)\\s*$`, 'i'), '$1')
    .replace(new RegExp(`^\\s*(?:\\*\\*)?@?${escapedName}(?:\\*\\*)?\\s*[:：]\\s*`, 'i'), '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (persona === 'mika') styled = styled.toLowerCase()
  if (persona === 'sora' && styled) styled = styled[0].toUpperCase() + styled.slice(1)
  if (persona === 'jules' && expressionBucket === 0 && !/[\p{Extended_Pictographic}]/u.test(styled)) styled = `${styled} ${['😅', '👀', '🤔'][stableBucket(styled, 3)]}`
  return styled
}

export const personaFailureFallback = (name) => personaFallbacks[String(name).trim().toLowerCase()] ?? 'that came out as silence. try me once more?'
export const personaRepairFallback = (name) => personaRepairFallbacks[String(name).trim().toLowerCase()] ?? 'fair—i got stuck on the wrong part of that.'
