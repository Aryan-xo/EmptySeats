import { stationName } from '../stations'

interface Props {
  trainNo: string
  trainName?: string
  jDate: string
  from: string
  to?: string
  loading: boolean
  onEdit: () => void
}

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** One-line recap of the search, shown instead of the full form once results are on screen. */
export function SearchSummary(p: Props) {
  return (
    <div className="search-summary">
      <button className="ss-main" onClick={p.onEdit} title="Change search">
        <span className="ss-train">
          <b>{p.trainNo}</b>
          {p.trainName && <span className="ss-name">{p.trainName}</span>}
        </span>
        <span className="ss-trip">
          <span className="ss-date">{fmtDate(p.jDate)}</span>
          <span className="ss-dot">·</span>
          <span title={stationName(p.from) || p.from}>{p.from}</span>
          {p.to && (
            <>
              <span className="ss-arrow">→</span>
              <span title={stationName(p.to) || p.to}>{p.to}</span>
            </>
          )}
        </span>
      </button>
      <button className="ss-edit" onClick={p.onEdit} disabled={p.loading}>
        {p.loading ? (
          <span className="spinner dark" />
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        )}
        <span>Edit</span>
      </button>
    </div>
  )
}
