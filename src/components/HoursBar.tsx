interface HoursBarProps {
  label: string
  hours: number
  limitHours: number
  showTime?: boolean
}

export function HoursBar({ label, hours, limitHours, showTime = true }: HoursBarProps) {
  const pct = Math.min((hours / limitHours) * 100, 100)
  const color = pct >= 95 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-success'
  const textColor = pct >= 95 ? 'text-danger' : pct >= 80 ? 'text-warning' : 'text-success'

  const fmt = (h: number) => {
    const hh = Math.floor(h)
    const mm = Math.round((h - hh) * 60)
    return mm ? `${hh}h ${mm}m` : `${hh}h`
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-text-muted font-medium uppercase tracking-wider">{label}</span>
        {showTime && (
          <span className={`text-xs font-semibold ${textColor}`}>
            {fmt(hours)} / {fmt(limitHours)}
          </span>
        )}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
