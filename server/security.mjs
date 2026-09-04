import crypto from 'node:crypto'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const SESSION_COOKIE = 'contexta_demo_session'

const base64url = (value) => Buffer.from(value).toString('base64url')
const sign = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url')

export function securityHeaders({ production = false, html = false } = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
  if (production) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  if (html) headers['Content-Security-Policy'] = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    "img-src 'self' data:",
    "media-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
  return headers
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie ?? '').split(';').flatMap((part) => {
    const index = part.indexOf('=')
    if (index < 1) return []
    return [[part.slice(0, index).trim(), part.slice(index + 1).trim()]]
  }))
}

export function createSessionManager({ secret, ttlMinutes = 240, secure = false }) {
  const create = (now = Date.now()) => {
    const payload = base64url(JSON.stringify({ exp: now + ttlMinutes * 60_000, nonce: crypto.randomBytes(16).toString('base64url') }))
    return `${payload}.${sign(payload, secret)}`
  }
  const verify = (token, now = Date.now()) => {
    if (!secret || typeof token !== 'string') return false
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra) return false
    const expected = sign(payload, secret)
    const suppliedBytes = Buffer.from(signature)
    const expectedBytes = Buffer.from(expected)
    if (suppliedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(suppliedBytes, expectedBytes)) return false
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      return Number.isSafeInteger(parsed.exp) && parsed.exp > now && typeof parsed.nonce === 'string'
    } catch { return false }
  }
  return {
    authenticated: (req) => verify(cookies(req)[SESSION_COOKIE]),
    createCookie: () => `${SESSION_COOKIE}=${create()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlMinutes * 60}${secure ? '; Secure' : ''}`,
    create,
    verify,
  }
}

export class MemoryRateLimiter {
  constructor({ perMinute, perDay, label }) {
    this.perMinute = perMinute
    this.perDay = perDay
    this.label = label
    this.minuteHits = new Map()
    this.dayKey = new Date().toISOString().slice(0, 10)
    this.dayHits = 0
  }

  check(identity = 'unknown', now = Date.now()) {
    const today = new Date(now).toISOString().slice(0, 10)
    if (today !== this.dayKey) { this.dayKey = today; this.dayHits = 0; this.minuteHits.clear() }
    if (this.dayHits >= this.perDay) return { allowed: false, retryAfter: 3600, message: `${this.label} daily limit reached.` }
    const minute = Math.floor(now / 60_000)
    const key = `${identity}:${minute}`
    const count = this.minuteHits.get(key) ?? 0
    if (count >= this.perMinute) return { allowed: false, retryAfter: 60, message: `Too many ${this.label.toLowerCase()} requests. Try again shortly.` }
    this.minuteHits.set(key, count + 1)
    this.dayHits += 1
    if (this.minuteHits.size > 2_000) this.minuteHits.clear()
    return { allowed: true }
  }
}

export async function verifyTurnstileToken({ token, secretKey, allowedHostnames = [], expectedAction = 'demo_access' }) {
  if (typeof token !== 'string' || !token.trim() || token.length > 2_048) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token, idempotency_key: crypto.randomUUID() }),
      signal: controller.signal,
    })
    if (!response.ok) return false
    const result = await response.json()
    const hostname = String(result?.hostname ?? '').toLowerCase()
    return result?.success === true && result?.action === expectedAction && (!allowedHostnames.length || allowedHostnames.includes(hostname))
  } catch { return false } finally { clearTimeout(timeout) }
}
