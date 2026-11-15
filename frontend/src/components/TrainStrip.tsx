import { useEffect, useRef } from 'react'
import type { Interval, Model } from '../logic'
import { berthStatus } from '../logic'

interface Props {
  model: Model
  span: Interval | null
  classFilter: Set<string>
  selected: string | null
  onSelect: (coach: string) => void
}

/** The whole rake: engine + every coach, with a count of usable berths. */
export function TrainStrip({ model, span, classFilter, selected, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll the strip sideways only; scrollIntoView would also scroll the whole page.
    const wrap = ref.current
    const el = wrap?.querySelector<HTMLElement>('.coach.sel')
    if (wrap && el) wrap.scrollTo({ left: el.offsetLeft - wrap.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' })
  }, [selected])

  return (
    <div className="strip-wrap" ref={ref}>
      <div className="strip" role="list">
        <div className="engine" aria-label="Engine">
          <span>🚂</span>
        </div>
        {model.coaches.map((c) => {
          const berths = [...(model.berths.get(c.coachName)?.values() ?? [])]
          const free = berths.filter((b) => berthStatus(b, span) === 'free').length
          const partial = span ? berths.filter((b) => berthStatus(b, span) === 'partial').length : 0
          const dim = classFilter.size > 0 && !classFilter.has(c.classCode)
          return (
            <button
              key={c.coachName}
              role="listitem"
              className={`coach cls-${c.classCode} ${selected === c.coachName ? 'sel' : ''} ${dim ? 'dim' : ''}`}
              onClick={() => onSelect(c.coachName)}
              title={`${c.coachName} (${c.classCode}): ${free} free${partial ? `, ${partial} partly free` : ''}`}
            >
              <span className="coach-name">{c.coachName}</span>
              <span className="coach-cls">{c.classCode}</span>
              <span className={`coach-count ${free ? 'has' : partial ? 'some' : ''}`}>{free || (partial ? `~${partial}` : 0)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
