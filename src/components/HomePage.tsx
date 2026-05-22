import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { HoursBar } from '../components/HoursBar'
import { BreakAlert } from '../components/BreakAlert'
import { JobCard } from '../components/JobCard'

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'Available',
  ON_SHIFT: 'On Shift',
  ON_ROUTE: 'On Route',
  OFF_SHIFT: 'Off Shift',
  DELAYED: 'Delayed',
}

const STATUS_COLOR: Record<string, string> = {
  AVAILABLE: 'text-success',
  ON_SHIFT: 'text-accent',
  ON_ROUTE: 'text-success',
  OFF_SHIFT: 'text-text-muted',
  DELAYED: 'text-warning',
}

export function HomePage() {
  const navigate = useNavigate()
  const driver = useStore((s) => s.driver)
  const setDriver = useStore((s) => s.setDriver)
  const jobs = useStore((s) => s.jobs)
  const compliance = useStore((s) => s.compliance)
  const gpsPosition = useStore((s) => s.gpsPosition)
  const session = useStore((s) => s.session)
  const isOnline = useStore((s) => s.isOnline)

  const [shiftLoading, setShiftLoading] = useState(false)
  const [availTomorrow, setAvailTomorrow] = useState(driver?.available_tomorrow ?? false)

  if (!driver || !session) return null

  const isOnShift = driver.status !== 'OFF_SHIFT'
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10) })()

  const todayJobs = jobs.filter((j) => j.for_date === today || (!j.for_date && isOnShift))
  const tomorrowJobs = jobs.filter((j) => j.for_date === tomorrow)
  const activeJobs = todayJobs.filter((j) => !['COMPLETED', 'CANCELLED'].includes(j.status))

  const toggleShift = async () => {
    setShiftLoading(true)
    try {
      const newStatus = isOnShift ? 'OFF_SHIFT' : 'AVAILABLE'
      const eventType = isOnShift ? 'END_SHIFT' : 'START_SHIFT'

      await supabase.from('drivers').update({
        status: newStatus,
        last_update_time: new Date().toISOString(),
        ...(isOnShift ? {} : {}),
      }).eq('id', driver.id)

      await supabase.from('driver_events').insert({
        driver_id: driver.id,
        type: eventType,
        payload: {},
      })

      setDriver({ ...driver, status: newStatus })
    } finally {
      setShiftLoading(false)
    }
  }

  const toggleAvailTomorrow = async () => {
    const next = !availTomorrow
    setAvailTomorrow(next)
    await supabase.from('drivers').update({
      available_tomorrow: next,
      // If opting in, save current GPS as tomorrow start
      ...(next && gpsPosition
        ? {
            tomorrow_start_lat: gpsPosition.lat,
            tomorrow_start_lon: gpsPosition.lon,
            tomorrow_start_updated_at: new Date().toISOString(),
          }
        : {}),
    }).eq('id', driver.id)
    setDriver({ ...driver, available_tomorrow: next })
  }

  return (
    <div className="min-h-screen bg-base pb-24">
      {/* Header */}
      <div className="px-4 pt-12 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-muted text-sm">Good {greeting()}</p>
            <h1 className="text-xl font-bold text-text-primary">{driver.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            {!isOnline && (
              <span className="text-xs bg-warning/20 text-warning px-2 py-1 rounded-full font-medium">
                Offline
              </span>
            )}
            {gpsPosition && (
              <span className="text-xs bg-success/20 text-success px-2 py-1 rounded-full font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                GPS
              </span>
            )}
            <span className={`text-sm font-semibold ${STATUS_COLOR[driver.status] ?? 'text-text-muted'}`}>
              {STATUS_LABELS[driver.status]}
            </span>
          </div>
        </div>
      </div>

      {/* Break alert */}
      <BreakAlert />

      {/* Shift toggle */}
      <div className="px-4 mb-4">
        <button
          onClick={toggleShift}
          disabled={shiftLoading}
          className={`w-full rounded-2xl py-5 font-bold text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-all ${
            isOnShift
              ? 'bg-danger/20 border border-danger/50 text-danger'
              : 'bg-success/20 border border-success/50 text-success'
          } disabled:opacity-60`}
        >
          {shiftLoading ? (
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <span>{isOnShift ? '⏹' : '▶️'}</span>
          )}
          {isOnShift ? 'End Shift' : 'Start Shift'}
        </button>
      </div>

      {/* Today summary */}
      {activeJobs.length > 0 ? (
        <section className="px-4 mb-6">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3">
            Today's Routes ({activeJobs.length})
          </h2>
          <div className="space-y-3">
            {activeJobs.slice(0, 3).map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
            {activeJobs.length > 3 && (
              <button
                onClick={() => navigate('/routes')}
                className="w-full text-center text-accent text-sm py-2 font-medium"
              >
                +{activeJobs.length - 3} more routes →
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="mx-4 mb-6 bg-card border border-border rounded-xl p-6 text-center">
          <p className="text-3xl mb-2">😴</p>
          <p className="text-text-primary font-semibold">No active routes</p>
          <p className="text-text-muted text-sm mt-1">
            {isOnShift ? 'Waiting for dispatch…' : 'Start your shift when ready'}
          </p>
        </div>
      )}

      {/* Hours compliance */}
      {compliance && (
        <section className="mx-4 mb-6 bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-widest">Driving Hours</h2>
          <HoursBar label="Today" hours={compliance.dailyHours} limitHours={9} />
          <HoursBar label="This Week" hours={compliance.weeklyHours} limitHours={56} />
          <HoursBar label="Fortnight" hours={compliance.fortnightHours} limitHours={90} />
        </section>
      )}

      {/* Tomorrow */}
      {!isOnShift && (
        <section className="mx-4 mb-6 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-widest">Tomorrow</h2>
            <button
              onClick={toggleAvailTomorrow}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                availTomorrow ? 'bg-accent' : 'bg-muted'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  availTomorrow ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <p className="text-sm text-text-muted">
            {availTomorrow
              ? `✓ Available${gpsPosition ? ' · Location saved' : ''}`
              : 'Mark yourself available for tomorrow\'s routes'}
          </p>
          {tomorrowJobs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-text-muted mb-2">{tomorrowJobs.length} route(s) planned for tomorrow</p>
              {tomorrowJobs.slice(0, 2).map((j) => (
                <JobCard key={j.id} job={j} showTomorrow />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
