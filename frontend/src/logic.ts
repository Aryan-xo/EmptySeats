import type { ChartResponse, CoachDetail, CoachInfo } from './types'
import { STATION_NAMES } from './stations'

export interface Seg {
  from: string
  to: string
}
/** Half-open interval of station indices: [a, b) means "free from station a until b". */
export interface Interval {
  a: number
  b: number
}

export interface Berth {
  coach: string
  cls: string
  no: number
  code: string
  segs: Seg[]
  intervals: Interval[]
}

export interface Model {
  stations: string[]
  names: Record<string, string>
  /** custom = typed by user, schedule = from HAR, coaches = from full coach charts (exact), guess = inferred */
  routeSource: 'custom' | 'schedule' | 'coaches' | 'guess'
  idx: Map<string, number>
  coaches: CoachInfo[]
  /** coach -> berthNo -> Berth (only berths that have any vacancy) */
  berths: Map<string, Map<number, Berth>>
}

// ---------------------------------------------------------------------------
// Station order
// ---------------------------------------------------------------------------

/** Topological order of stations from "A comes before B" edges. Ties keep first-seen order. */
export function orderStations(edges: [string, string][], hints: string[] = []): string[] {
  const seen = new Map<string, number>()
  const touch = (s: string) => {
    if (s && !seen.has(s)) seen.set(s, seen.size)
  }
  hints.forEach(touch)
  edges.forEach(([a, b]) => (touch(a), touch(b)))

  const out = new Map<string, Set<string>>()
  const indeg = new Map<string, number>()
  for (const s of seen.keys()) (out.set(s, new Set()), indeg.set(s, 0))
  for (const [a, b] of edges) {
    if (!a || !b || a === b || out.get(a)!.has(b)) continue
    out.get(a)!.add(b)
    indeg.set(b, indeg.get(b)! + 1)
  }

  const order: string[] = []
  const ready = [...seen.keys()].filter((s) => indeg.get(s) === 0)
  while (ready.length) {
    ready.sort((x, y) => seen.get(x)! - seen.get(y)!)
    const s = ready.shift()!
    order.push(s)
    for (const n of out.get(s)!) {
      indeg.set(n, indeg.get(n)! - 1)
      if (indeg.get(n) === 0) ready.push(n)
    }
  }
  // Cycles (bad data) — append whatever is left in first-seen order.
  for (const s of seen.keys()) if (!order.includes(s)) order.push(s)
  return order
}

// ---------------------------------------------------------------------------
// Coach composition (detailed layout) — parsed defensively
// ---------------------------------------------------------------------------

export interface DetailSeg extends Seg {
  occupied: boolean | null
  quota?: string
}
export interface DetailBerth {
  no: number
  code: string
  segs: DetailSeg[]
}

const asArr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : []
const asStr = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))

export function parseCoachDetail(d: CoachDetail | undefined): DetailBerth[] {
  if (!d) return []
  const list = asArr(d.bdd ?? d.berthDetails ?? d.berths)
  return list
    .map((b) => {
      const segs = asArr(b.bsd ?? b.berthStatusDetails ?? b.segments).map((s) => {
        const occ = s.occupancy ?? s.occupied ?? s.isOccupied
        return {
          from: asStr(s.from),
          to: asStr(s.to),
          occupied:
            typeof occ === 'boolean'
              ? occ
              : occ == null
                ? null
                : ['Y', 'TRUE', '1', 'OCCUPIED'].includes(asStr(occ).toUpperCase()),
          quota: asStr(s.quota) || undefined,
        }
      })
      return {
        no: Number(b.berthNo ?? b.berthNumber ?? b.seatNo ?? 0),
        code: asStr(b.berthCode),
        segs,
      }
    })
    .filter((b) => b.no > 0)
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export function buildModel(
  chart: ChartResponse,
  routeOverride: string[] | null,
  details: Record<string, CoachDetail>,
): Model {
  const comp = chart.composition
  const all = Object.values(chart.vacant).flatMap((v) => v ?? [])
  const names: Record<string, string> = {}

  let stations: string[]
  let routeSource: Model['routeSource']
  const detailBerths = Object.values(details).flatMap((d) => parseCoachDetail(d))
  if (routeOverride?.length) {
    stations = routeOverride
    routeSource = 'custom'
  } else if (chart.stations?.length) {
    stations = chart.stations.map((s) => s.stationCode)
    chart.stations.forEach((s) => s.stationName && (names[s.stationCode] = s.stationName))
    routeSource = 'schedule'
  } else {
    routeSource = detailBerths.length ? 'coaches' : 'guess'
    const edges: [string, string][] = []
    // Full berth chains (A→B→C…) from coach charts give the exact order; add them first.
    for (const b of detailBerths) b.segs.forEach((s) => edges.push([s.from, s.to]))
    all.forEach((v) => edges.push([v.from.trim(), v.to.trim()]))
    const chain = [comp.from, comp.remote, comp.nextRemote, comp.destinationStation, comp.to]
      .filter((s): s is string => !!s)
      .filter((s, i, arr) => arr.indexOf(s) === i)
    for (let i = 0; i + 1 < chain.length; i++) edges.push([chain[i], chain[i + 1]])
    stations = orderStations(edges, chain)
    // Source first, destination last regardless of tie-breaks.
    const dest = comp.destinationStation || comp.to
    if (dest && stations.includes(dest)) stations = [...stations.filter((s) => s !== dest), dest]
  }
  for (const s of stations) if (!names[s] && STATION_NAMES[s]) names[s] = STATION_NAMES[s]

  const idx = new Map(stations.map((s, i) => [s, i]))
  const coachCls = new Map(comp.cdd.map((c) => [c.coachName, c.classCode]))
  const berths = new Map<string, Map<number, Berth>>()

  for (const v of all) {
    const coach = v.coachName.trim()
    if (!berths.has(coach)) berths.set(coach, new Map())
    const m = berths.get(coach)!
    const b =
      m.get(v.berthNumber) ??
      ({
        coach,
        cls: coachCls.get(coach) ?? '',
        no: v.berthNumber,
        code: v.berthCode.trim(),
        segs: [],
        intervals: [],
      } satisfies Berth)
    b.segs.push({ from: v.from.trim(), to: v.to.trim() })
    m.set(v.berthNumber, b)
  }
  for (const m of berths.values())
    for (const b of m.values()) b.intervals = mergeIntervals(b.segs, idx)

  const coaches = [...comp.cdd].sort(
    (x, y) =>
      (x.positionFromEngine || 0) - (y.positionFromEngine || 0) ||
      classRank(x.classCode) - classRank(y.classCode) ||
      x.coachName.localeCompare(y.coachName, undefined, { numeric: true }),
  )

  return { stations, names, routeSource, idx, coaches, berths }
}

export function mergeIntervals(segs: Seg[], idx: Map<string, number>): Interval[] {
  const iv = segs
    .map((s) => ({ a: idx.get(s.from) ?? -1, b: idx.get(s.to) ?? -1 }))
    .filter((i) => i.a >= 0 && i.b > i.a)
    .sort((x, y) => x.a - y.a)
  const out: Interval[] = []
  for (const i of iv) {
    const last = out[out.length - 1]
    if (last && i.a <= last.b) last.b = Math.max(last.b, i.b)
    else out.push({ ...i })
  }
  return out
}

export const covers = (iv: Interval[], a: number, b: number) => iv.some((i) => i.a <= a && i.b >= b)
export const overlaps = (iv: Interval[], a: number, b: number) => iv.some((i) => i.a < b && i.b > a)
export const freeLen = (iv: Interval[]) => iv.reduce((n, i) => n + i.b - i.a, 0)

export type Status = 'free' | 'partial' | 'taken'

export function berthStatus(b: Berth | undefined, span: Interval | null): Status {
  if (!b || !b.intervals.length) return 'taken'
  if (!span) return 'free'
  if (covers(b.intervals, span.a, span.b)) return 'free'
  if (overlaps(b.intervals, span.a, span.b)) return 'partial'
  return 'taken'
}

// ---------------------------------------------------------------------------
// A berth's whole journey as consecutive blocks (for the timeline)
// ---------------------------------------------------------------------------

export interface Block {
  a: number
  b: number
  state: 'free' | 'taken' | 'unknown'
  quota?: string
}

export function berthBlocks(model: Model, berth: Berth | undefined, detail: DetailBerth | undefined): Block[] {
  const last = model.stations.length - 1
  if (last < 1) return []
  // State of every stretch i → i+1. Coach chart first (gives quotas, often ends at the
  // charting station), then the vacancy list on top: it is the source of truth for "free".
  const state: Block['state'][] = new Array(last).fill('taken')
  const quota: (string | undefined)[] = new Array(last).fill(undefined)
  for (const sg of detail?.segs ?? []) {
    const a = model.idx.get(sg.from) ?? -1
    const b = model.idx.get(sg.to) ?? -1
    for (let i = Math.max(a, 0); a >= 0 && i < b; i++) {
      state[i] = sg.occupied === false ? 'free' : sg.occupied ? 'taken' : 'unknown'
      quota[i] = sg.quota
    }
  }
  for (const iv of berth?.intervals ?? []) for (let i = iv.a; i < iv.b; i++) state[i] = 'free'

  const out: Block[] = []
  for (let i = 0; i < last; i++) {
    const prev = out[out.length - 1]
    const q = state[i] === 'free' ? undefined : quota[i]
    if (prev && prev.state === state[i] && prev.quota === q) prev.b = i + 1
    else out.push({ a: i, b: i + 1, state: state[i], quota: q })
  }
  return out
}

// ---------------------------------------------------------------------------
// Split-journey finder: hop between berths to cover a span with as few changes as possible.
// ---------------------------------------------------------------------------

export interface Hop {
  berth: Berth
  a: number
  b: number
}

export function findSplitJourney(
  berths: Berth[],
  span: Interval,
): { hops: Hop[]; stuckAt: number | null } {
  const hops: Hop[] = []
  let p = span.a
  let prev: Berth | null = null
  while (p < span.b) {
    let best: Hop | null = null
    for (const b of berths)
      for (const i of b.intervals) {
        if (i.a > p || i.b <= p) continue
        const reach = Math.min(i.b, span.b)
        const better =
          !best ||
          reach > best.b ||
          (reach === best.b && prev && b.coach === prev.coach && best.berth.coach !== prev.coach)
        if (better) best = { berth: b, a: p, b: reach }
      }
    if (!best) return { hops, stuckAt: p }
    // Same berth continuing → extend the previous hop.
    const last = hops[hops.length - 1]
    if (last && last.berth === best.berth) last.b = best.b
    else hops.push(best)
    prev = best.berth
    p = best.b
  }
  return { hops, stuckAt: null }
}

// ---------------------------------------------------------------------------
// Class metadata
// ---------------------------------------------------------------------------

const RANK = ['EA', 'EV', '1A', 'EC', '2A', 'FC', '3A', '3E', 'CC', 'SL', '2S', 'VS']
export const classRank = (c: string) => {
  const i = RANK.indexOf(c)
  return i < 0 ? RANK.length : i
}

export const CLASS_NAMES: Record<string, string> = {
  '1A': 'First AC',
  '2A': 'AC 2-tier',
  '3A': 'AC 3-tier',
  '3E': 'AC 3 Economy',
  SL: 'Sleeper',
  CC: 'AC Chair Car',
  EC: 'Executive Chair',
  EA: 'Executive Anubhuti',
  EV: 'Vistadome',
  '2S': 'Second Sitting',
  FC: 'First Class',
  VS: 'Vistadome NAC',
}
