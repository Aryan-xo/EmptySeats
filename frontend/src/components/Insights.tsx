import type { Interval, Model } from '../logic'
import { CLASS_NAMES, berthStatus, classRank } from '../logic'
import { stationName } from '../stations'

/** Per-class totals + "where do seats open up" along the route. */
export function Insights({ model, span }: { model: Model; span: Interval | null }) {
  const byClass = new Map<string, { coaches: number; any: number; trip: number }>()
  for (const c of model.coaches) {
    const row = byClass.get(c.classCode) ?? { coaches: 0, any: 0, trip: 0 }
    row.coaches++
    for (const b of model.berths.get(c.coachName)?.values() ?? []) {
      row.any++
      if (span && berthStatus(b, span) === 'free') row.trip++
    }
    byClass.set(c.classCode, row)
  }

  const opens = new Array(model.stations.length).fill(0) as number[]
  for (const m of model.berths.values()) for (const b of m.values()) for (const i of b.intervals) opens[i.a]++
  const top = opens
    .map((n, i) => ({ s: model.stations[i], n }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
  const max = Math.max(1, ...top.map((t) => t.n))

  return (
    <>
      <section className="card">
        <h4>Vacancy by class</h4>
        <div className="class-rows">
          {[...byClass.entries()]
            .sort((a, b) => classRank(a[0]) - classRank(b[0]))
            .map(([cls, r]) => (
              <div className="class-row" key={cls}>
                <span className={`chip cls-${cls} on`}>{cls}</span>
                <span className="class-name">
                  {CLASS_NAMES[cls] ?? cls}
                  <small className="muted"> · {r.coaches} coach{r.coaches > 1 ? 'es' : ''}</small>
                </span>
                <span className="class-num" title="Berths free somewhere on the route">
                  {r.any}
                </span>
                {span && (
                  <span className={`class-num trip ${r.trip ? 'good' : ''}`} title="Free for your whole trip">
                    {r.trip}
                  </span>
                )}
              </div>
            ))}
        </div>
        <p className="muted tiny">
          Left: free somewhere on the route{span ? ' · Right: free for your whole trip' : ''}
        </p>
      </section>
      <section className="card">
        <h4>Where seats open up</h4>
        <p className="muted tiny">Vacant stretches starting at each station: good places to board.</p>
        {top.length === 0 && <p className="muted">No vacancies.</p>}
        <ul className="bars">
          {top.map((t) => (
            <li key={t.s}>
              <span className="bar-label" title={stationName(t.s)}>
                <b>{t.s}</b> <small className="muted">{model.names[t.s] || stationName(t.s)}</small>
              </span>
              <span className="bar-track">
                <span className="bar" style={{ width: `${(t.n / max) * 100}%` }} />
              </span>
              <span className="bar-n">{t.n}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
