import { useStore } from '../lib/store'

export function BreakAlert() {
  const compliance = useStore((s) => s.compliance)
  const driver = useStore((s) => s.driver)

  if (!compliance || driver?.status !== 'ON_ROUTE') return null
  if (!compliance.breakUrgent && !compliance.breakDue) return null

  const mins = Math.max(0, compliance.continuousDrivingMins)
  const remaining = compliance.breakDue ? 0 : Math.max(0, 4.5 * 60 - mins)
  const hh = Math.floor(remaining / 60)
  const mm = Math.round(remaining % 60)
  const timeStr = remaining > 0 ? (hh ? `${hh}h ${mm}m` : `${mm}m`) : 'NOW'

  return (
    <div
      className={`mx-4 mb-3 rounded-xl p-3.5 flex items-center gap-3 ${
        compliance.breakDue
          ? 'bg-danger/20 border border-danger/50'
          : 'bg-warning/20 border border-warning/50'
      }`}
    >
      <span className="text-2xl">☕</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${compliance.breakDue ? 'text-danger' : 'text-warning'}`}>
          {compliance.breakDue ? 'Break required now' : 'Break due soon'}
        </p>
        <p className="text-xs text-text-muted">
          {compliance.breakDue
            ? `Driving ${Math.round(mins)}m — UK law requires a 45-min break`
            : `Break in ${timeStr} — ${Math.round(mins)}m continuous`}
        </p>
      </div>
      {compliance.breakDue && (
        <span className="text-danger font-bold text-lg animate-pulse">!</span>
      )}
    </div>
  )
}
