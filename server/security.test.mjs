import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionManager, MemoryRateLimiter, securityHeaders } from './security.mjs'

test('signed demo sessions expire and reject tampering', () => {
  const sessions = createSessionManager({ secret: 'a-test-secret-that-is-longer-than-32-characters', ttlMinutes: 5, secure: true })
  const now = Date.now()
  const token = sessions.create(now)
  assert.equal(sessions.verify(token, now + 1_000), true)
  assert.equal(sessions.verify(`${token.slice(0, -1)}x`, now + 1_000), false)
  assert.equal(sessions.verify(token, now + 6 * 60_000), false)
  assert.match(sessions.createCookie(), /HttpOnly/)
  assert.match(sessions.createCookie(), /SameSite=Strict/)
  assert.match(sessions.createCookie(), /Secure/)
})

test('rate limiter enforces per-identity and global daily limits before reset', () => {
  const perVisitor = new MemoryRateLimiter({ perMinute: 2, perDay: 10, label: 'Test' })
  assert.equal(perVisitor.check('one', 0).allowed, true)
  assert.equal(perVisitor.check('one', 1).allowed, true)
  assert.equal(perVisitor.check('one', 2).allowed, false)
  assert.equal(perVisitor.check('two', 3).allowed, true)

  const global = new MemoryRateLimiter({ perMinute: 10, perDay: 2, label: 'Test' })
  assert.equal(global.check('one', 0).allowed, true)
  assert.equal(global.check('two', 1).allowed, true)
  assert.equal(global.check('three', 2).allowed, false)
})

test('production document headers include transport and browser isolation policy', () => {
  const headers = securityHeaders({ production: true, html: true })
  assert.match(headers['Content-Security-Policy'], /challenges\.cloudflare\.com/)
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.match(headers['Strict-Transport-Security'], /max-age=/)
  assert.equal(headers['Referrer-Policy'], 'no-referrer')
  assert.match(headers['Permissions-Policy'], /camera=\(\)/)
})
