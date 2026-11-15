import { useMemo, useState } from 'react'
import type { Berth, Interval, Model } from '../logic'
import { CLASS_NAMES, berthStatus, classRank, findSplitJourney } from '../logic'
import { berthCode } from '../layout'
import { stationName } from '../stations'
import { StationPicker } from './StationPicker'

interface Props {
  model: Model
  from: string
  to: string
  wantedTo: string
  routeLoading: boolean
  classFilter: Set<string>
  span: Interval | null
  onFrom: (s: string) => void
  onTo: (s: string) => void
  onToggleClass: (c: string | null) => void
  onRoute: (route: string[] | null) => void
  onPick: (coach: string, no: number) => void
}

const byCoach = (a: Berth, b: Berth) =>
  classRank(a.cls) - classRank(b.cls) || a.coach.localeCompare(b.coach, undefined, { numeric: true }) || a.no - b.no

/** "Your trip": from/to + class filter, and the answer to "what's free for me?" */
export function TripPanel(p: Props) {
  const { model, span } = p
  const [editing, setEditing] = useState(false)
  const [routeText, setRouteText] = useState('')
  const name = (s: string) => model.names[s] || stationName(s)
  const opt = (s: string) => (name(s) ? `${name(s)} (${s})` : s)
  const fromIdx = model.idx.get(p.from) ?? -1

  const classes = useMemo(
    () => [...new Set(model.coaches.map((c) => c.classCode))].sort((a, b) => classRank(a) - classRank(b)),
    [model],
  )
  const pool = useMemo(
    () =>
      [...model.berths.values()]
        .flatMap((m) => [...m.values()])
        .filter((b) => p.classFilter.size === 0 || p.classFilter.has(b.cls)),
    [model, p.classFilter],
  )

  const full = span ? pool.filter((b) => berthStatus(b, span) === 'free').sort(byCoach) : []
  const partial = span ? pool.filter((b) => berthStatus(b, span) === 'partial').length : 0
  const split = span && full.length === 0 ? findSplitJourney(pool, span) : null

  const groups = new Map<string, Berth[]>()
  for (const b of full) groups.set(b.coach, [...(groups.get(b.coach) ?? []), b])
  const perClass = new Map<string, number>()
  for (const b of full) perClass.set(b.cls, (perClass.get(b.cls) ?? 0) + 1)

  const toMissing = p.wantedTo && !model.idx.has(p.wantedTo)

  return (
    <section className="card trip">
      <div className="trip-head">
        <h3>Your trip</h3>
        <RouteBadge source={model.routeSource} loading={p.routeLoading} count={model.stations.length} />
      </div>

      <div className="trip-pick">
        <label className="field">
          <span>From</span>
          <StationPicker
            value={p.from}
            stations={model.stations.slice(0, -1).map((s) => [s, name(s)] as [string, string])}
            emptyLabel="Train start"
            onChange={p.onFrom}
          />
        </label>
        <span className="arrow" aria-hidden>
          →
        </span>
        <label className="field">
          <span>To</span>
          <StationPicker
            value={p.to}
            stations={model.stations
              .slice(Math.max(fromIdx, 0) + 1)
              .map((s) => [s, name(s)] as [string, string])}
            emptyLabel="End of route"
            onChange={p.onTo}
          />
        </label>
      </div>

      <div className="chips classes">
        <button className={`chip all ${p.classFilter.size === 0 ? 'on' : ''}`} onClick={() => p.onToggleClass(null)}>
          All classes
        </button>
        {classes.map((c) => (
          <button
            key={c}
            className={`chip cls-${c} ${p.classFilter.has(c) ? 'on' : ''}`}
            onClick={() => p.onToggleClass(c)}
            title={CLASS_NAMES[c] ?? c}
          >
            {c} <small>{CLASS_NAMES[c] ?? ''}</small>
          </button>
        ))}
      </div>

      {toMissing && (
        <p className="note">
          <b>{opt(p.wantedTo)}</b> isn't a point where any berth changes hands on this chart, so we can't place it on
          the route. Pick the nearest stop <b>after</b> it in “To”.
        </p>
      )}

      {model.routeSource === 'guess' && !p.routeLoading && (
        <p className="note">
          Station order is a best guess.{' '}
          <button className="link" onClick={() => (setRouteText(model.stations.join(' ')), setEditing((v) => !v))}>
            Fix the route
          </button>
        </p>
      )}
      {editing && (
        <div className="route-edit">
          <textarea
            value={routeText}
            onChange={(e) => setRouteText(e.target.value.toUpperCase())}
            rows={3}
            placeholder="Station codes in travel order, separated by spaces"
          />
          <div className="row gap">
            <button
              className="primary"
              onClick={() => (p.onRoute(routeText.split(/[\s,>→-]+/).filter(Boolean)), setEditing(false))}
            >
              Save route
            </button>
            <button onClick={() => (p.onRoute(null), setEditing(false))}>Reset</button>
          </div>
        </div>
      )}

      <div className="answer">
        {!span ? (
          <p className="muted">Choose where you get on and off to see which seats are free for your whole trip.</p>
        ) : full.length > 0 ? (
          <>
            <div className="answer-head good">
              <span className="big-num">{full.length}</span>
              <div>
                <b>
                  berth{full.length > 1 ? 's' : ''} free all the way
                </b>
                <div className="muted small">
                  {name(model.stations[span.a]) || model.stations[span.a]} → {name(model.stations[span.b]) || model.stations[span.b]}
                  {partial > 0 && ` · ${partial} more partly free`}
                </div>
              </div>
              <div className="chips right">
                {[...perClass.entries()].map(([c, n]) => (
                  <span key={c} className={`chip cls-${c} on`}>
                    {c} · {n}
                  </span>
                ))}
              </div>
            </div>
            <div className="groups">
              {[...groups.entries()].map(([coach, list]) => (
                <div className="group" key={coach}>
                  <span className={`group-coach cls-${list[0].cls}`}>{coach}</span>
                  <div className="group-berths">
                    {list.map((b) => (
                      <button key={b.no} className="mini-berth" onClick={() => p.onPick(b.coach, b.no)}>
                        {b.no} <small>{berthCode(b.cls, b.no, b.code)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : split && split.hops.length > 0 ? (
          <>
            <div className="answer-head warn">
              <span className="big-num">0</span>
              <div>
                <b>No single berth is free the whole way</b>
                <div className="muted small">But you can hop between {split.hops.length} berths:</div>
              </div>
            </div>
            <ol className="hops">
              {split.hops.map((h, i) => (
                <li key={i}>
                  <span className="hop-route">
                    {model.stations[h.a]} → {model.stations[h.b]}
                    <small className="muted">
                      {' '}
                      {name(model.stations[h.a])} to {name(model.stations[h.b])}
                    </small>
                  </span>
                  <button className="mini-berth" onClick={() => p.onPick(h.berth.coach, h.berth.no)}>
                    {h.berth.coach}-{h.berth.no} <small>{berthCode(h.berth.cls, h.berth.no, h.berth.code)}</small>
                  </button>
                </li>
              ))}
            </ol>
            {split.stuckAt != null && (
              <p className="warn small">Nothing free from {opt(model.stations[split.stuckAt])} onwards.</p>
            )}
          </>
        ) : (
          <div className="answer-head bad">
            <span className="big-num">0</span>
            <div>
              <b>Nothing free on this trip</b>
              <div className="muted small">Try another class, or a nearby boarding station.</div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function RouteBadge({ source, loading, count }: { source: Model['routeSource']; loading: boolean; count: number }) {
  if (loading && source === 'guess')
    return (
      <span className="badge">
        <span className="spinner dark" /> Working out exact stops…
      </span>
    )
  const text = {
    coaches: `✓ Exact route · ${count} stops`,
    schedule: `✓ Timetable route · ${count} stops`,
    custom: `Your route · ${count} stops`,
    guess: `Estimated route · ${count} stops`,
  }[source]
  return <span className={`badge ${source === 'guess' ? 'warn' : 'ok'}`}>{text}</span>
}
