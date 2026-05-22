import { haversineKm, etaMinutes } from '../lib/gps'
import type { JobWithStops } from '../lib/types'
import type { GPSPosition } from '../lib/gps'

interface Props {
  job: JobWithStops
  driverPosition: GPSPosition | null
}

export function StopTimeline({ job, driverPosition }: Props) {
  const stops = job.stops

  return (
    <ol className="relative space-y-0">
      {stops.map((stop, i) => {
        const isFirst = i === 0
        const isLast = i === stops.length - 1
        const arrived = !!stop.arrived_at
        const isNext = !arrived && stops.slice(0, i).every((s) => !!s.arrived_at)

        const wh = stop.warehouse

        let eta: string | null = null
        if (isNext && driverPosition && wh) {
          const dist = haversineKm(driverPosition.lat, driverPosition.lon, wh.latitude, wh.longitude)
          const mins = etaMinutes(dist)
          eta = mins < 2 ? 'Arriving' : mins < 60 ? `~${mins} min` : `~${Math.round(mins / 60)}h`
        }

        const dotColor = arrived
          ? 'bg-success border-success'
          : isNext
          ? 'bg-accent border-accent animate-pulse'
          : 'bg-muted border-border'

        const kindIcon = stop.kind === 'PICKUP' ? '📦' : '🏁'
        const kindLabel = stop.kind === 'PICKUP' ? 'Pickup' : 'Drop-off'

        return (
          <li key={stop.id} className="flex gap-4">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center">
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${dotColor}`} />
              {!isLast && <div className="w-0.5 flex-1 bg-border my-1" />}
            </div>

            {/* Content */}
            <div className={`pb-4 flex-1 min-w-0 ${isFirst ? '' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-text-primary">
                    {kindIcon} {kindLabel}
                  </p>
                  <p className="text-base font-bold text-text-primary mt-0.5">
                    {wh?.code} — {wh?.name}
                  </p>
                  {wh?.address && (
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{wh.address}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {arrived ? (
                    <span className="text-xs text-success font-semibold">
                      ✓ {new Date(stop.arrived_at!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : isNext && eta ? (
                    <span className="text-xs text-accent font-semibold">{eta}</span>
                  ) : stop.scheduled_at ? (
                    <span className="text-xs text-text-muted">
                      {new Date(stop.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Map link */}
              {wh && (
                <a
                  href={`https://maps.google.com/?q=${wh.latitude},${wh.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open in Maps
                </a>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
