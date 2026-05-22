import { useNavigate } from 'react-router-dom'
import type { JobWithStops } from '../lib/types'

interface Props {
  job: JobWithStops
  showTomorrow?: boolean
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:            { label: 'Planned',       color: 'text-text-muted', bg: 'bg-muted' },
  ASSIGNED:           { label: 'Assigned',      color: 'text-accent',     bg: 'bg-accent/15' },
  IN_PROGRESS:        { label: 'In Progress',   color: 'text-success',    bg: 'bg-success/15' },
  ARRIVED_PICKUP:     { label: 'At Pickup',     color: 'text-warning',    bg: 'bg-warning/15' },
  EN_ROUTE_DELIVERY:  { label: 'En Route',      color: 'text-accent',     bg: 'bg-accent/15' },
  COMPLETED:          { label: 'Completed',     color: 'text-success',    bg: 'bg-success/15' },
}

export function JobCard({ job, showTomorrow }: Props) {
  const navigate = useNavigate()
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.PENDING

  const pickups = job.stops.filter((s) => s.kind === 'PICKUP')
  const drops = job.stops.filter((s) => s.kind === 'DROP')
  const arrived = job.stops.filter((s) => s.arrived_at).length
  const total = job.stops.length

  const startWh = pickups[0]?.warehouse
  const endWh = drops[drops.length - 1]?.warehouse

  const time = job.planned_start_at
    ? new Date(job.planned_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : job.scheduled_at
    ? new Date(job.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <button
      onClick={() => navigate(`/routes/${job.id}`)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 flex flex-col gap-3 active:scale-[0.99] transition-transform"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-text-primary">{job.reference}</p>
          {showTomorrow && (
            <p className="text-xs text-accent font-medium mt-0.5">Tomorrow</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {time && (
            <span className="text-xs text-text-muted font-mono">{time}</span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.color} ${cfg.bg}`}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Route summary */}
      <div className="flex items-center gap-2 text-sm">
        <div className="flex-1 min-w-0">
          <p className="text-text-muted truncate">
            {startWh ? `📦 ${startWh.code} ${startWh.name}` : '—'}
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-text-muted shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary font-medium truncate">
            {endWh ? `🏁 ${endWh.code} ${endWh.name}` : '—'}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>{total} stops</span>
          {job.equipment_type && <span>· {job.equipment_type}</span>}
        </div>
        {total > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-success rounded-full transition-all"
                style={{ width: `${(arrived / total) * 100}%` }}
              />
            </div>
            <span className="text-xs text-text-muted">{arrived}/{total}</span>
          </div>
        )}
      </div>
    </button>
  )
}
