import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginWithPairingCode } from '../lib/auth'
import { useStore } from '../lib/store'

export function LoginPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setSession = useStore((s) => s.setSession)
  const navigate = useNavigate()

  const digits = code.replace(/\D/g, '').slice(0, 6)

  const handleSubmit = async () => {
    if (digits.length !== 6) return
    setLoading(true)
    setError(null)
    try {
      const session = await loginWithPairingCode(digits)
      setSession(session)
      navigate('/', { replace: true })
    } catch (e: any) {
      setError(e.message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base flex flex-col items-center justify-center px-6">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-card border border-border flex items-center justify-center mb-4">
          <span className="text-4xl">🚚</span>
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Driver App</h1>
        <p className="text-sm text-text-muted mt-1">Enter your pairing code to get started</p>
      </div>

      {/* Code input */}
      <div className="w-full max-w-sm space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-widest mb-2">
            6-Digit Pairing Code
          </label>
          <input
            type="number"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={digits}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="000000"
            className="w-full bg-card border border-border rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-[0.5em] text-text-primary placeholder-border focus:outline-none focus:border-accent transition-colors"
          />
          <p className="text-xs text-text-muted mt-2 text-center">
            Ask your dispatcher to generate a code in the dashboard
          </p>
        </div>

        {error && (
          <div className="bg-danger/15 border border-danger/40 rounded-xl px-4 py-3">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={digits.length !== 6 || loading}
          className="w-full bg-accent text-white rounded-xl py-4 font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Verifying…
            </span>
          ) : 'Login'}
        </button>
      </div>

      <p className="text-xs text-text-muted mt-8 text-center px-6">
        This app replaces Telegram for route management. Your location will be shared automatically while on shift.
      </p>
    </div>
  )
}
