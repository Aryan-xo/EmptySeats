import type { Berth, Interval, Model } from '../logic'
import { berthStatus, freeLen } from '../logic'
import type { DetailBerth } from '../logic'
import { berthCode, layoutFor } from '../layout'

interface Props {
  model: Model
  coach: string
  cls: string
  span: Interval | null
  detail: DetailBerth[]
  selected: number | null
  onSelect: (no: number) => void
}

export function CoachMap({ model, coach, cls, span, detail, selected, onSelect }: Props) {
  const berths = model.berths.get(coach) ?? new Map<number, Berth>()
  const detailMax = detail.reduce((m, d) => Math.max(m, d.no), 0)
  const maxSeen = Math.max(0, detailMax, ...berths.keys())
  const spec = layoutFor(cls, maxSeen)
  const total = model.stations.length - 1 || 1
  const detailCode = new Map(detail.map((d) => [d.no, d.code]))

  const cell = (no: number) => {
    if (no > spec.capacity) return <div key={no} className="berth void" />
    const b = berths.get(no)
    const st = berthStatus(b, span)
    const code = berthCode(cls, no, b?.code || detailCode.get(no))
    const frac = b ? freeLen(b.intervals) / total : 0
    return (
      <button
        key={no}
        className={`berth ${st} ${selected === no ? 'sel' : ''}`}
        style={st === 'free' && !span ? { ['--frac' as string]: frac.toFixed(2) } : undefined}
        onClick={() => onSelect(no)}
        title={
          b
            ? `${coach}-${no} ${code}\nFree: ${b.segs.map((s) => `${s.from}→${s.to}`).join(', ')}`
            : `${coach}-${no} ${code}\nOccupied`
        }
      >
        <span className="bn">{no}</span>
        <span className="bc">{code}</span>
      </button>
    )
  }

  const groups: number[][] = []
  const unit = spec.kind === 'sleeper8' ? 8 : spec.kind === 'sleeper6' ? 6 : spec.kind === 'cabin4' ? 4 : (spec.perRow ?? 5)
  for (let start = 1; start <= spec.capacity; start += unit)
    groups.push(Array.from({ length: unit }, (_, i) => start + i))

  return (
    <div className="coachmap-wrap">
      <div className={`coachmap ${spec.kind}`}>
        <div className="coach-end">◀ {coach}</div>
        {spec.kind === 'seats' ? (
          <div className="seat-grid">
            {groups.map((row, r) => (
              <div className="seat-row" key={r}>
                {row.map((no, i) => (
                  <div key={no} className="seat-slot">
                    {cell(no)}
                    {i + 1 === spec.aisleAfter && <div className="seat-aisle" />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          groups.map((g, gi) => {
            // sleeper8: [LB MB UB LB MB UB SL SU]; sleeper6: [LB UB LB UB SL SU]; cabin4: [LB UB LB UB]
            const [mainA, mainB, side] =
              spec.kind === 'sleeper8'
                ? [[g[2], g[1], g[0]], [g[5], g[4], g[3]], [g[6], g[7]]]
                : spec.kind === 'sleeper6'
                  ? [[g[1], g[0]], [g[3], g[2]], [g[4], g[5]]]
                  : [[g[1], g[0]], [g[3], g[2]], []]
            return (
              <div className="bay" key={gi}>
                <div className="bay-main">
                  <div className="bench">{mainA.map(cell)}</div>
                  <div className="bench">{mainB.map(cell)}</div>
                </div>
                <div className="aisle" />
                <div className="bay-side">{side.map(cell)}</div>
              </div>
            )
          })
        )}
        <div className="coach-end">{coach} ▶</div>
      </div>
    </div>
  )
}
