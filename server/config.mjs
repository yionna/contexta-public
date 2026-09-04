const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required server environment variable: ${name}`)
  if (/replace|your-|example/i.test(value)) throw new Error(`${name} still contains a placeholder value`)
  return value
}

const positiveInt = (name, fallback) => {
  const parsed = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

const optional = (name) => process.env[name]?.trim() ?? ''

const strongSecret = (name) => {
  const value = required(name)
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`)
  return value
}

export function loadConfig() {
  const production = process.env.NODE_ENV === 'production'
  const authRequired = production || process.env.DEMO_AUTH_REQUIRED === 'true'
  const allowedHostnames = optional('TURNSTILE_ALLOWED_HOSTNAMES').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (authRequired && !allowedHostnames.length) throw new Error('TURNSTILE_ALLOWED_HOSTNAMES must list at least one permitted hostname')
  const accountId = required('CLOUDFLARE_ACCOUNT_ID')
  const apiBaseUrl = required('AI_API_BASE_URL').replace(/\/$/, '')
  const expectedPath = `/accounts/${accountId}/ai/v1`
  const parsedUrl = new URL(apiBaseUrl)

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'api.cloudflare.com' || !parsedUrl.pathname.endsWith(expectedPath)) {
    throw new Error('AI_API_BASE_URL must be the Cloudflare Workers AI endpoint for CLOUDFLARE_ACCOUNT_ID')
  }

  return Object.freeze({
    provider: process.env.AI_PROVIDER ?? 'cloudflare-workers-ai',
    apiBaseUrl,
    apiToken: required('CLOUDFLARE_AI_API_TOKEN'),
    generationModel: required('AI_GENERATION_MODEL'),
    embeddingModel: required('AI_EMBEDDING_MODEL'),
    embeddingDimensions: positiveInt('AI_EMBEDDING_DIMENSIONS', 1024),
    maxOutputTokens: positiveInt('AI_MAX_OUTPUT_TOKENS', 700),
    reportMaxOutputTokens: positiveInt('AI_REPORT_MAX_OUTPUT_TOKENS', 2200),
    requestsPerMinute: positiveInt('AI_REQUESTS_PER_MINUTE', 8),
    requestsPerDay: positiveInt('AI_REQUESTS_PER_DAY', 150),
    externalRequestsPerMinute: positiveInt('EXTERNAL_REQUESTS_PER_MINUTE', 20),
    externalRequestsPerDay: positiveInt('EXTERNAL_REQUESTS_PER_DAY', 500),
    demoMode: process.env.AI_DEMO_MODE === 'true',
    production,
    trustProxy: process.env.TRUST_PROXY === 'true',
    port: positiveInt('PORT', process.env.AI_SERVER_PORT ?? 8787),
    auth: Object.freeze({
      required: authRequired,
      siteKey: authRequired ? required('TURNSTILE_SITE_KEY') : optional('TURNSTILE_SITE_KEY'),
      secretKey: authRequired ? required('TURNSTILE_SECRET_KEY') : optional('TURNSTILE_SECRET_KEY'),
      sessionSecret: authRequired ? strongSecret('SESSION_SECRET') : optional('SESSION_SECRET'),
      allowedHostnames,
      sessionTtlMinutes: positiveInt('SESSION_TTL_MINUTES', 240),
    }),
  })
}
