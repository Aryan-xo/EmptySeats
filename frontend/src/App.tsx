import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, getSource, type Source } from './api'
import type { ChartQuery, ChartResponse, CoachDetail, Train } from './types'

type CoachesQueryBase = {
  trainNo: string
  boardingStation: string
  remoteStation: string
  trainSourceStation: string
  jDate: string
  coaches: { coach: string; cls: string }[]
}
import type { Interval } from './logic'
import { CLASS_NAMES, berthStatus, buildModel, parseCoachDetail } from './logic'
import { stationName } from './stations'
import { SearchForm, type Recent } from './components/SearchForm'
import { SearchSummary } from './components/SearchSummary'
import { knownRoute, saveExactRoute, type KnownRoute } from './routes'
import { TrainStrip } from './components/TrainStrip'
import { CoachMap } from './components/CoachMap'
import { BerthPanel } from './components/BerthPanel'
import { TripPanel } from './components/TripPanel'
import { Insights } from './components/Insights'
import { Landing } from './components/Landing'

const today = () => new Date().toLocaleDateString('en-CA')

function readUrl(): ChartQuery {
  const u = new URLSearchParams(location.search)
  return {
    trainNo: u.get('train') ?? '',
    jDate: u.get('date') ?? today(),
    boardingStation: u.get('from') ?? '',
    to: u.get('to') ?? undefined,
    offline: u.get('offline') === '1',
  }
}

// --- tiny localStorage helpers (storage may be unavailable) ---
function getLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function setLS(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

/** "2026-11-15 06:35:16" → "15 Nov, 06:35" */
function fmtChart(s?: string | null) {
  if (!s) return null
  const d = new Date(s.replace(' ', 'T'))
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

const vacantCount = (res: ChartResponse, coach: string) =>
  Object.values(res.vacant)
    .flatMap((v) => v ?? [])
    .filter((v) => v.coachName.trim() === coach).length

function friendlyError(msg: string): { title: string; body: string } {
  const m = msg.toLowerCase()
  if (m.includes('no record') || m.includes('not prepared') || m.includes('chart'))
    return {
      title: "This train's chart isn't available yet",
      body: 'First chart: the night before (around 8 PM) for trains leaving between 5 AM and 2 PM, otherwise about 10 hours before departure. Final chart: 30 min before departure. Check the date: use the date the train leaves your boarding station.',
    }
  if (m.includes('blocking requests from this network'))
    return {
      title: 'IRCTC has paused requests from your network',
      body: "Too many requests reached IRCTC from your connection, so it's refusing them for a few minutes. We've stopped asking for a bit so the block doesn't get longer. Try again in a few minutes, or switch networks (e.g. Wi-Fi to mobile data).",
    }
  if (m.includes('403') || m.includes('forbidden') || m.includes('refused this server'))
    return {
      title: 'IRCTC blocked the request',
      body: 'IRCTC is turning requests away right now (it does this in bursts). We already retried a few times. Wait a minute and try again, or switch networks (e.g. Wi-Fi to mobile data).',
    }
  if (m.includes('http2') || m.includes('empty response') || m.includes('error sending request'))
    return {
      title: "IRCTC didn't answer",
      body: 'Their servers refused or dropped the request. Try again in a minute, or open the chart on irctc.co.in, save the Network tab as a HAR file and import it under “More options”.',
    }
  if (m.includes('not in imported data'))
    return { title: 'Not in the imported file', body: 'Turn off “Use imported data only” to fetch live data.' }
  return { title: "Couldn't load the chart", body: msg }
}

export default function App() {
  const [trains, setTrains] = useState<Train[]>([])
  const [query, setQuery] = useState<ChartQuery>(readUrl)
  const [chart, setChart] = useState<ChartResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [offline, setOffline] = useState(() => readUrl().offline ?? false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [source, setSource] = useState<Source | null>(null)
  const [recent, setRecent] = useState<Recent[]>(() => getLS('recent', []))

  const [route, setRoute] = useState<string[] | null>(null)
  const [details, setDetails] = useState<Record<string, CoachDetail>>({})
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeProgress, setRouteProgress] = useState<{ done: number; total: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [hint, setHint] = useState<KnownRoute | null>(null)
  const [coach, setCoach] = useState<string | null>(null)
  const coachRef = useRef<string | null>(null)
  useEffect(() => {
    coachRef.current = coach
  }, [coach])
  // Coach charts are fetched on demand (one request each), not all ~25 up front: far fewer IRCTC requests,
  // so far fewer 403s. ctx.gen ties responses to the search that asked for them.
  const ctxRef = useRef<{ gen: number; base: Omit<CoachesQueryBase, 'coaches'>; offline: boolean } | null>(null)
  const inflight = useRef(new Set<string>())
  const [coachLoading, setCoachLoading] = useState<Set<string>>(new Set())
  const [coachFailed, setCoachFailed] = useState<Set<string>>(new Set())

  const fetchCoaches = useCallback((list: { coach: string; cls: string }[], forRoute = false) => {
    const ctx = ctxRef.current
    if (!ctx) return
    const gen = ctx.gen
    const key = (c: string) => `${gen}:${c}`
    const todo = list.filter((c) => !inflight.current.has(key(c.coach)))
    if (!todo.length) return
    const names = todo.map((c) => c.coach)
    names.forEach((c) => inflight.current.add(key(c)))
    const current = () => ctxRef.current?.gen === gen
    setCoachLoading((s) => new Set([...s, ...names]))
    setCoachFailed((s) => new Set([...s].filter((c) => !names.includes(c))))
    if (forRoute) setRouteLoading(true)
    api
      .coaches(
        { ...ctx.base, coaches: todo, offline: ctx.offline },
        forRoute ? (done, total) => current() && setRouteProgress({ done, total }) : undefined,
        (c, d) => current() && setDetails((prev) => ({ ...prev, [c]: d })),
      )
      .then((r) => {
        if (!current()) return
        setDetails((prev) => ({ ...prev, ...r.details }))
        const failed = Object.keys(r.errors)
        if (failed.length) setCoachFailed((s) => new Set([...s, ...failed]))
      })
      .catch(() => current() && setCoachFailed((s) => new Set([...s, ...names])))
      .finally(() => {
        names.forEach((c) => inflight.current.delete(key(c)))
        if (!current()) return
        setCoachLoading((s) => new Set([...s].filter((c) => !names.includes(c))))
        if (forRoute) {
          setRouteLoading(false)
          setRouteProgress(null)
        }
      })
  }, [])
  const [berthNo, setBerthNo] = useState<number | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [classFilter, setClassFilter] = useState<Set<string>>(new Set())
  const autoPick = useRef(false)
  const lastTried = useRef<ChartQuery | null>(null)

  useEffect(() => {
    api.trains().then(setTrains).catch(() => setTrains([]))
  }, [])

  const load = useCallback(
    async (q: ChartQuery, opts: { keepSelection?: boolean } = {}) => {
      if (!q.trainNo || !q.boardingStation) return
      lastTried.current = q
      const useOffline = q.offline ?? offline
      setLoading(true)
      setError(null)
      // Look up the train's known stop order alongside the chart (instant if cached).
      const hintP = knownRoute(q.trainNo).catch(() => null)
      try {
        const res = await api.chart({ ...q, offline: useOffline })
        setHint(await hintP)
        if (res.error) throw new Error(res.error)
        setSource(getSource())
        setChart(res)
        setQuery(q)
        setEditing(false)
        setRoute(getLS<string[] | null>(`route:${q.trainNo}`, null))
        if (!opts.keepSelection) {
          setDetails({})
          setCoach(null)
          setBerthNo(null)
          setFrom(q.boardingStation)
          setTo(q.to ?? '')
          setClassFilter(new Set())
          autoPick.current = true
        }
        const u = new URLSearchParams({ train: q.trainNo, date: q.jDate, from: q.boardingStation })
        if (q.to) u.set('to', q.to)
        if (useOffline) u.set('offline', '1')
        history.replaceState(null, '', `?${u}`)

        const item: Recent = {
          trainNo: q.trainNo,
          trainName: res.composition.trainName,
          boardingStation: q.boardingStation,
          to: q.to,
        }
        setRecent((prev) => {
          const next = [item, ...prev.filter((r) => !(r.trainNo === item.trainNo && r.boardingStation === item.boardingStation && r.to === item.to))].slice(0, 5)
          setLS('recent', next)
          return next
        })

        // Coach charts: the selected coach is fetched when it's opened (effect below). Up front we only fetch a
        // few busy coaches when the stop order isn't known yet (train not in the timetable, never searched here).
        const c = res.composition
        ctxRef.current = {
          gen: (ctxRef.current?.gen ?? 0) + 1,
          base: {
            trainNo: c.trainNo || q.trainNo,
            boardingStation: q.boardingStation,
            remoteStation: c.remote,
            trainSourceStation: c.from,
            jDate: c.trainStartDate,
          },
          offline: useOffline,
        }
        setCoachLoading(new Set())
        setCoachFailed(new Set())
        const known = await hintP
        if (opts.keepSelection) {
          // Refresh: re-read only the coach on screen.
          const sel = coachRef.current
          const cls = c.cdd.find((x) => x.coachName === sel)?.classCode
          if (sel && cls) fetchCoaches([{ coach: sel, cls }])
        } else if (!known) {
          const busiest = [...c.cdd]
            .sort((a, b) => vacantCount(res, b.coachName) - vacantCount(res, a.coachName))
            .slice(0, 4)
            .map((x) => ({ coach: x.coachName, cls: x.classCode }))
          fetchCoaches(busiest, true)
        }
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [offline, fetchCoaches],
  )

  // Load from URL on first visit. Deep links: ?…&to=JBP&coach=M1&berth=51
  // A browser refresh goes back to the homepage instead (the form stays pre-filled).
  useEffect(() => {
    const q = readUrl()
    if (!q.trainNo || !q.boardingStation) return
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type === 'reload') {
      history.replaceState(null, '', location.pathname)
      return
    }
    const u = new URLSearchParams(location.search)
    load(q).then(() => {
      if (u.get('coach')) (setCoach(u.get('coach')!), (autoPick.current = false))
      if (Number(u.get('berth')) > 0) setBerthNo(Number(u.get('berth')))
    })
  }, [])

  useEffect(() => {
    if (!autoRefresh || offline || !chart) return
    const t = setInterval(() => load(query, { keepSelection: true }), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [autoRefresh, offline, chart, query, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBerthNo(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const model = useMemo(() => (chart ? buildModel(chart, route, details, hint) : null), [chart, route, details, hint])

  // Once coach charts reveal the exact stop order, remember it so the search form can offer those stops next time.
  useEffect(() => {
    if (!routeLoading && hint?.source !== 'timetable' && Object.keys(details).length && model?.routeSource === 'coaches')
      saveExactRoute(query.trainNo, model.stations)
  }, [model, routeLoading, details, hint, query.trainNo])

  // Fetch the open coach's chart (berth-by-berth bookings and quotas) when it's first shown.
  useEffect(() => {
    if (!coach || !chart || details[coach] || coachFailed.has(coach)) return
    const cls = chart.composition.cdd.find((x) => x.coachName === coach)?.classCode
    if (cls) fetchCoaches([{ coach, cls }])
  }, [coach, chart, details, coachFailed, fetchCoaches])

  const span: Interval | null = useMemo(() => {
    if (!model) return null
    const a = from ? (model.idx.get(from) ?? -1) : 0
    const b = to ? (model.idx.get(to) ?? -1) : model.stations.length - 1
    return a >= 0 && b > a ? { a, b } : null
  }, [model, from, to])

  // Open the most useful coach once data is in.
  useEffect(() => {
    if (!model || !autoPick.current || coach) return
    // Most berths free for the whole trip wins; partly-free berths break ties.
    let best: string | null = null
    let bestScore = 0
    for (const c of model.coaches) {
      if (classFilter.size && !classFilter.has(c.classCode)) continue
      const list = [...(model.berths.get(c.coachName)?.values() ?? [])]
      const score =
        list.filter((b) => berthStatus(b, span) === 'free').length * 1000 +
        list.filter((b) => berthStatus(b, span) === 'partial').length
      if (score > bestScore) (best = c.coachName), (bestScore = score)
    }
    if (best) setCoach(best)
  }, [model, span, coach, classFilter])

  const onImport = async (file: File) => {
    setToast('Importing…')
    try {
      const res = await api.importHar(await file.text())
      const n = Object.entries(res.imported)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
      if (!res.charts.length) {
        setToast(n ? `Imported ${n}, but no train chart was found in it.` : 'No IRCTC chart data found in that file.')
        return
      }
      setToast(`Imported ${n}`)
      setOffline(true)
      const c = res.charts[res.charts.length - 1]
      await load({ trainNo: String(c.trainNo), jDate: String(c.jDate), boardingStation: String(c.boardingStation), offline: true })
    } catch (e) {
      setToast(`Import failed: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const comp = chart?.composition
  const coachCls = comp?.cdd.find((c) => c.coachName === coach)?.classCode ?? ''
  const detail = coach ? parseCoachDetail(details[coach]) : []
  const coachBerths = coach && model ? [...(model.berths.get(coach)?.values() ?? [])] : []
  const coachFree = coachBerths.filter((b) => berthStatus(b, span) === 'free').length
  const coachPartial = span ? coachBerths.filter((b) => berthStatus(b, span) === 'partial').length : 0
  const err = error ? friendlyError(error) : null
  const sname = (s?: string | null) => (s ? model?.names[s] || stationName(s) || s : '')

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <a className="nav-brand" href="/" aria-label="Empty Seats home">
            <Logo />
            <span className="nav-name">
              Empty<span>Seats</span>
            </span>
            <span className="nav-tag">beta</span>
          </a>
          <div className="nav-links">
            {!chart && (
              <>
                <a href="#preview">Preview</a>
                <a href="#how">How it works</a>
                <a href="#faq">FAQ</a>
              </>
            )}
            <span className={`live-pill ${offline ? 'off' : ''}`} title={
                offline
                  ? 'Using imported HAR data'
                  : source === 'browser'
                    ? 'Charts are fetched by your browser straight from IRCTC'
                    : source === 'server'
                      ? 'Charts are fetched by the EmptySeats server'
                      : 'Fetching live charts from IRCTC'
              }>
              <span className="live-dot" /> {offline ? 'Offline data' : 'Live IRCTC charts'}
            </span>
          </div>
        </div>
      </nav>

      <header className={`hero ${chart ? 'compact' : ''}`}>
        <div className="hero-bg" aria-hidden>
          <div className="hero-glow g1" />
          <div className="hero-glow g2" />
          <div className="hero-grid" />
          <div className="hero-track">
            <span className="hero-train">🚆</span>
          </div>
        </div>
        <div className="hero-inner">
          {!chart && (
            <div className="hero-copy">
              <span className="hero-kicker">🎫 Waiting list ticket confirm nahi hua? Don't give up yet.</span>
              <h1>
                Find the <em>empty berths</em> left
                <br /> after the chart is prepared.
              </h1>
              <p>
                Cancellations and no-shows leave berths empty once IRCTC charts a train. See every one, coach by coach,
                and exactly which stretch of the route it's free for, from <b>your</b> station to <b>yours</b>.
              </p>
              <div className="hero-classes" aria-label="Classes covered">
                <span className="hc-label">Every coach</span>
                {['1A', '2A', '3A', '3E', 'SL', 'CC', '2S'].map((c) => (
                  <span key={c} className={`hc-chip cls-${c}`}>
                    {c}
                  </span>
                ))}
              </div>
              <div className="hero-points">
                <span>🛤️ Free from your stop to your stop</span>
                <span>🔀 No single berth? Hop between two</span>
                <span>⚡ Free, no login</span>
              </div>
            </div>
          )}
          {chart && !editing ? (
            <SearchSummary
              trainNo={query.trainNo}
              trainName={chart.composition.trainName}
              jDate={query.jDate}
              from={query.boardingStation}
              to={query.to}
              loading={loading}
              onEdit={() => setEditing(true)}
            />
          ) : (
          <SearchForm
            key={`${query.trainNo}|${query.jDate}|${query.boardingStation}|${query.to ?? ''}`}
            trains={trains}
            initial={query}
            recent={recent}
            loading={loading}
            offline={offline}
            autoRefresh={autoRefresh}
            onOffline={setOffline}
            onAutoRefresh={setAutoRefresh}
            onSubmit={(q) => load(q)}
            onImport={onImport}
          />
          )}
        </div>
      </header>

    <div className="app">
      {err && (
        <div className="card error-card">
          <div className="error-icon">!</div>
          <div>
            <b>{err.title}</b>
            <p>{err.body}</p>
            {err.body !== error && <p className="muted tiny">Details: {error}</p>}
            {err && (
              <button className="retry-btn" onClick={() => lastTried.current && load(lastTried.current, { keepSelection: !!chart })} disabled={loading}>
                {loading ? <span className="spinner dark" /> : 'Try again'}
              </button>
            )}
          </div>
        </div>
      )}

      {loading && !chart && <Skeleton />}

      {comp && model && (
        <>
          <section className="card train-head">
            <div className="th-main">
              <div className="eyebrow">Train {comp.trainNo}</div>
              <h2>{comp.trainName}</h2>
              <div className="th-route">
                <span>
                  <b>{comp.from}</b> {sname(comp.from)}
                </span>
                <span className="th-arrow">→</span>
                <span>
                  <b>{comp.destinationStation || comp.to}</b> {sname(comp.destinationStation || comp.to)}
                </span>
                <span className="muted">· left source {fmtChart(comp.trainStartDate + ' 00:00')?.split(',')[0]}</span>
              </div>
            </div>
            <div className="th-status">
              <span className={`status-dot ${comp.chartTwoDate ? 'final' : comp.chartOneDate ? 'first' : ''}`} />
              <div>
                <b>{comp.chartTwoDate ? 'Final chart ready' : comp.chartOneDate ? 'First chart ready' : 'Chart pending'}</b>
                <div className="muted small">
                  {fmtChart(comp.chartTwoDate || comp.chartOneDate)} · charted at {comp.remote}
                  {comp.nextRemote ? ` · next chart at ${comp.nextRemote}` : ''}
                </div>
              </div>
              <button
                className="icon-btn"
                title="Refresh"
                onClick={() => load(query, { keepSelection: true })}
                disabled={loading}
              >
                {loading ? <span className="spinner dark" /> : '↻'}
              </button>
            </div>
            {(comp._stale || Object.keys(chart.errors).length > 0) && (
              <div
                className="th-warn"
                title={Object.entries(chart.errors)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n')}
              >
                <span className="th-warn-icon" aria-hidden>!</span>
                <span>
                  {comp._stale && (
                    <>
                      <b>Saved data from {fmtChart(chart.fetchedAt)}.</b> IRCTC isn't responding right now.{' '}
                    </>
                  )}
                  {Object.keys(chart.errors).length > 0 && (
                    <>
                      Couldn't load <b>{Object.keys(chart.errors).sort().join(', ')}</b>, so those coaches may look full.
                    </>
                  )}
                </span>
                <button className="th-warn-retry" onClick={() => load(query, { keepSelection: true })} disabled={loading}>
                  {loading ? <span className="spinner dark" /> : 'Retry'}
                </button>
              </div>
            )}
          </section>

          <div className="layout">
            <main className="main-col">
              <TripPanel
                model={model}
                from={from}
                to={to}
                wantedTo={query.to ?? ''}
                routeLoading={routeLoading}
                routeProgress={routeProgress}
                classFilter={classFilter}
                span={span}
                onFrom={(s) => {
                  setFrom(s)
                  if (to && (model.idx.get(to) ?? 0) <= (model.idx.get(s) ?? -1)) setTo('')
                }}
                onTo={setTo}
                onToggleClass={(c) =>
                  setClassFilter((prev) => {
                    if (c === null) return new Set()
                    const n = new Set(prev)
                    if (n.has(c)) n.delete(c)
                    else n.add(c)
                    return n
                  })
                }
                onRoute={(r) => (setLS(`route:${query.trainNo}`, r), setRoute(r))}
                onPick={(c, n) => (setCoach(c), setBerthNo(n))}
              />

              <section className="card">
                <div className="sec-head">
                  <h3>Pick a coach</h3>
                  <Legend span={!!span} />
                </div>
                <TrainStrip
                  model={model}
                  span={span}
                  classFilter={classFilter}
                  selected={coach}
                  onSelect={(c) => (setCoach(c === coach ? null : c), setBerthNo(null))}
                />
              </section>

              {coach && (
                <section className="card">
                  <div className="sec-head">
                    <h3>
                      Coach {coach} <span className={`chip cls-${coachCls} on`}>{coachCls}</span>{' '}
                      <small className="muted">{CLASS_NAMES[coachCls]}</small>
                    </h3>
                    <div className="coach-stats">
                      {coachLoading.has(coach) && !details[coach] && (
                        <span className="stat" title="Loading this coach's chart from IRCTC">
                          <span className="spinner dark" /> chart
                        </span>
                      )}
                      {coachFailed.has(coach) && !details[coach] && (
                        <button
                          className="stat retry-stat"
                          title="Couldn't load this coach's chart. Free/booked still shows from the vacancy list."
                          onClick={() => setCoachFailed((s) => new Set([...s].filter((x) => x !== coach)))}
                        >
                          ↻ Retry chart
                        </button>
                      )}
                      <span className="stat good">{coachFree} free</span>
                      {span && <span className="stat warn">{coachPartial} partly</span>}
                    </div>
                  </div>
                  <CoachMap
                    model={model}
                    coach={coach}
                    cls={coachCls}
                    span={span}
                    detail={detail}
                    selected={berthNo}
                    onSelect={setBerthNo}
                  />
                  <p className="muted tiny">Tap any berth to see its full journey. Scroll sideways for the whole coach.</p>
                </section>
              )}
            </main>

            <aside className="side-col">
              {coach && berthNo != null ? (
                <>
                  <div className="sheet-backdrop" onClick={() => setBerthNo(null)} />
                  <BerthPanel
                    model={model}
                    coach={coach}
                    cls={coachCls}
                    no={berthNo}
                    berth={model.berths.get(coach)?.get(berthNo)}
                    detail={detail.find((d) => d.no === berthNo)}
                    span={span}
                    onClose={() => setBerthNo(null)}
                  />
                </>
              ) : (
                <div className="card placeholder">
                  <div className="ph-icon">🛏️</div>
                  <b>Tap a berth</b>
                  <p className="muted small">See where it's free, where it's booked, and under which quota.</p>
                </div>
              )}
              <Insights model={model} span={span} />
            </aside>
          </div>
        </>
      )}

      {!chart && !loading && (
        <Landing
          onStart={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' })
            setTimeout(() => document.querySelector<HTMLInputElement>('.search input')?.focus(), 400)
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>

      <footer className="footer">
        <div className="footer-inner">
          <div className="nav-brand">
            <Logo />
            <span className="nav-name">
              Empty<span>Seats</span>
            </span>
          </div>
          <p className="muted small">
            An independent tool that reads IRCTC’s public reservation charts. Not affiliated with IRCTC or Indian
            Railways. Station names from the open datameet/railways dataset.
          </p>
        </div>
      </footer>
    </>
  )
}

function Logo() {
  return (
    <svg className="logo-svg" viewBox="0 0 40 40" width="36" height="36" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#lg)" />
      <rect x="11" y="8" width="18" height="19" rx="5" fill="#fff" />
      <rect x="14" y="11" width="12" height="7" rx="2" fill="#4f46e5" opacity=".85" />
      <circle cx="15.5" cy="22.5" r="1.8" fill="#4f46e5" />
      <circle cx="24.5" cy="22.5" r="1.8" fill="#4f46e5" />
      <path d="M14 27l-3 5M26 27l3 5M12.5 30h15" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function Legend({ span }: { span: boolean }) {
  return (
    <div className="legend">
      <span>
        <i className="sw free" /> {span ? 'Free whole trip' : 'Free somewhere'}
      </span>
      {span && (
        <span>
          <i className="sw partial" /> Partly free
        </span>
      )}
      <span>
        <i className="sw taken" /> Booked
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="skeleton-wrap">
      <div className="card sk" style={{ height: 96 }} />
      <div className="layout">
        <div className="main-col">
          <div className="card sk" style={{ height: 220 }} />
          <div className="card sk" style={{ height: 120 }} />
        </div>
        <div className="side-col">
          <div className="card sk" style={{ height: 160 }} />
        </div>
      </div>
      <p className="muted small center">Fetching the chart from IRCTC… this can take 10–20 seconds.</p>
    </div>
  )
}
