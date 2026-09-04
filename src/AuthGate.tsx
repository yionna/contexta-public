import { useEffect, useRef, useState, type ReactNode } from 'react'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

type SessionState = { required?: boolean; authenticated?: boolean; siteKey?: string }

function TurnstileChallenge({ siteKey, onAuthenticated }: { siteKey: string; onAuthenticated: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef('')
  const [message, setMessage] = useState('checking your browser…')

  useEffect(() => {
    let cancelled = false
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widgetId.current) return
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action: 'demo_access',
        theme: 'auto',
        size: 'flexible',
        callback: async (token: string) => {
          setMessage('opening the live demo…')
          try {
            const response = await fetch('/api/auth/turnstile', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            })
            if (!response.ok) throw new Error('Verification failed.')
            onAuthenticated()
          } catch {
            setMessage('verification expired or failed. please try again.')
            if (widgetId.current) window.turnstile?.reset(widgetId.current)
          }
        },
        'error-callback': () => setMessage('verification could not load. check your connection and retry.'),
        'expired-callback': () => setMessage('verification expired. please retry.'),
      })
    }

    if (window.turnstile) render()
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-contexta-turnstile]')
      const script = existing ?? document.createElement('script')
      script.addEventListener('load', render)
      if (!existing) {
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.defer = true
        script.dataset.contextaTurnstile = 'true'
        document.head.appendChild(script)
      }
      return () => { cancelled = true; script.removeEventListener('load', render); if (widgetId.current) window.turnstile?.remove(widgetId.current); widgetId.current = '' }
    }
    return () => { cancelled = true; if (widgetId.current) window.turnstile?.remove(widgetId.current); widgetId.current = '' }
  }, [onAuthenticated, siteKey])

  return <main className="auth-gate">
    <section>
      <span className="auth-gate-mark">C</span>
      <p>CONTEXTA PUBLIC DEMO</p>
      <h1>one quick check</h1>
      <span>This protects the live research and AI allowance from automated abuse.</span>
      <div ref={container} className="turnstile-slot" />
      <small aria-live="polite">{message}</small>
    </section>
  </main>
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'challenge' | 'open' | 'error'>('checking')
  const [siteKey, setSiteKey] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session check failed.')
        return response.json() as Promise<SessionState>
      })
      .then((session) => {
        if (cancelled) return
        if (session.authenticated || !session.required) setState('open')
        else if (session.siteKey) { setSiteKey(session.siteKey); setState('challenge') }
        else setState('error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  if (state === 'open') return children
  if (state === 'challenge') return <TurnstileChallenge siteKey={siteKey} onAuthenticated={() => setState('open')} />
  return <main className="auth-gate"><section><span className="auth-gate-mark">C</span><p>CONTEXTA PUBLIC DEMO</p><h1>{state === 'checking' ? 'loading…' : 'demo service unavailable'}</h1><span>{state === 'error' ? 'The browser could not reach the protected API. Please try again shortly.' : 'Checking whether this browser already has access.'}</span></section></main>
}
