import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { securityHeaders } from './security.mjs'

const DIST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.txt', 'text/plain; charset=utf-8'], ['.webp', 'image/webp'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
])

const insideDist = (candidate) => candidate === DIST_ROOT || candidate.startsWith(`${DIST_ROOT}${path.sep}`)

async function regularFile(candidate) {
  try { return (await fs.promises.stat(candidate)).isFile() } catch { return false }
}

export async function serveStatic(req, res, pathname, { production = false } = {}) {
  if (!['GET', 'HEAD'].includes(req.method)) return false
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return false }
  const relative = decoded.replace(/^\/+/, '')
  let candidate = path.resolve(DIST_ROOT, relative || 'index.html')
  if (!insideDist(candidate)) return false
  if (!(await regularFile(candidate))) {
    if (path.extname(relative)) return false
    candidate = path.join(DIST_ROOT, 'index.html')
    if (!(await regularFile(candidate))) return false
  }

  const extension = path.extname(candidate).toLowerCase()
  const isHtml = extension === '.html'
  const headers = {
    ...securityHeaders({ production, html: isHtml }),
    'Content-Type': TYPES.get(extension) ?? 'application/octet-stream',
    'Cache-Control': isHtml ? 'no-cache' : relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  }
  const stat = await fs.promises.stat(candidate)
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  if (req.method === 'HEAD') { res.end(); return true }
  fs.createReadStream(candidate).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end() }).pipe(res)
  return true
}
