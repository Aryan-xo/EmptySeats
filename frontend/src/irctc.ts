/**
 * Talk to IRCTC's public chart API straight from the visitor's browser.
 *
 * IRCTC answers these endpoints with `Access-Control-Allow-Origin: *`, and the request then
 * comes from the visitor's own browser and network, exactly like opening irctc.co.in.
 * Cloud servers (e.g. Vercel) often get 403 from IRCTC's CDN, so this is the preferred path
 * when hosted. Mirrors the Rust backend's /api/chart and /api/coaches.
 *
 * IRCTC's CDN also refuses bursts now and then (403/429, or a blocked response with no CORS
 * header, which the browser reports as a network error). To ride those out politely:
 * - requests are spaced out, and the spacing grows after a refusal and shrinks again on success
 * - a refused request is retried a couple of times with backoff
 * - identical requests in flight are shared, and good answers are cached (2 min fresh)
 * - the last good answer is kept in localStorage and shown (marked as saved) if IRCTC keeps refusing
 */
import type { ChartQuery, ChartResponse, CoachDetail, Composition, VacantBerth } from './types'

const BASE = 'https://www.irctc.co.in/online-charts/api/'
const TTL = 2 * 60 * 1000
const STALE_MAX = 12 * 60 * 60 * 1000
const LS_PREFIX = 'irctc:'
const RETRY_DELAYS = [1500, 4000]

const cache = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<Result<unknown>>>()

export class IrctcHttpError extends Error {
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

type Result<T> = { value: T; at: number; stale: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5)

// ---- pacing: one shared clock for every request ------------------------------------------
const MIN_GAP = 150
const MAX_GAP = 2500
let gap = MIN_GAP
let nextSlot = 0
let coolUntil = 0

async function pace() {
  const now = Date.now()
  const start = Math.max(now, nextSlot, coolUntil)
  nextSlot = start + gap
  if (start > now) await sleep(start - now)
}

function refused(retryAfterMs?: number) {
  gap = Math.min(MAX_GAP, gap * 2)
  coolUntil = Math.max(coolUntil, Date.now() + (retryAfterMs ?? jitter(2000)))
}

function succeeded() {
  gap = Math.max(MIN_GAP, Math.round(gap * 0.8))
}

// ---- saved answers -----------------------------------------------------------------------
function loadSaved<T>(key: string): { at: number; value: T } | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const hit = JSON.parse(raw) as { at: number; value: T }
    return Date.now() - hit.at < STALE_MAX ? hit : null
  } catch {
    return null
  }
}

function save(key: string, at: number, value: unknown) {
  const raw = JSON.stringify({ at, value })
  try {
    localStorage.setItem(LS_PREFIX + key, raw)
  } catch {
    // Probably full: drop our older entries and try once more.
    try {
      const ours = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX))
      ours.forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(LS_PREFIX + key, raw)
    } catch {
      /* storage unavailable: memory cache still works */
    }
  }
}

// ---- one request, with retries -----------------------------------------------------------
const retryable = (e: unknown) => {
  if (e instanceof IrctcHttpError) return e.status === 0 || e.status === 403 || e.status === 429 || e.status >= 500
  return e instanceof TypeError // network error, or a block page without CORS headers
}

async function once<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  await pace()
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    const ra = Number(res.headers.get('retry-after'))
    if (res.status === 403 || res.status === 429) refused(ra > 0 ? Math.min(ra, 30) * 1000 : undefined)
    throw new IrctcHttpError(`IRCTC returned HTTP ${res.status}`, res.status)
  }
  if (!text.trim()) throw new IrctcHttpError('IRCTC returned an empty response')
  succeeded()
  return JSON.parse(text) as T
}

async function fetchWithRetry<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(endpoint, body)
    } catch (e) {
      if (e instanceof TypeError) refused()
      if (attempt >= RETRY_DELAYS.length || !retryable(e)) throw e
      await sleep(jitter(RETRY_DELAYS[attempt]))
    }
  }
}

const isNoRecord = (e: unknown) => typeof e === 'string' && e.trim().toLowerCase() === 'no record found'

/** Worth keeping as a fallback: real data, not an error like "Chart not prepared". */
const keepable = (v: unknown) => {
  const err = (v as { error?: unknown } | null)?.error
  return !err || isNoRecord(err)
}

function post<T>(endpoint: string, body: Record<string, unknown>): Promise<Result<T>> {
  const key = endpoint + JSON.stringify(body)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve({ value: hit.value as T, at: hit.at, stale: false })

  const running = inflight.get(key)
  if (running) return running as Promise<Result<T>>

  const p = (async (): Promise<Result<T>> => {
    try {
      const value = await fetchWithRetry<T>(endpoint, body)
      const at = Date.now()
      if (keepable(value)) {
        cache.set(key, { at, value })
        save(key, at, value)
      }
      return { value, at, stale: false }
    } catch (e) {
      const old = (hit && Date.now() - hit.at < STALE_MAX ? hit : null) ?? loadSaved<T>(key)
      if (old) return { value: old.value as T, at: old.at, stale: true }
      throw e
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

// ---- the two calls the app makes ----------------------------------------------------------
export async function chartDirect(q: ChartQuery): Promise<ChartResponse> {
  const trainNo = q.trainNo.trim()
  const bstn = q.boardingStation.trim().toUpperCase()
  const compR = await post<Composition>('trainComposition', { trainNo, jDate: q.jDate, boardingStation: bstn })
  const comp = compR.value
  if (comp.error) return { error: comp.error, composition: comp } as ChartResponse

  const classes = [...new Set((comp.cdd ?? []).map((c) => c.classCode))].sort()
  const chartType = comp.chartTwoDate ? 2 : 1
  const base = {
    trainNo,
    boardingStation: bstn,
    remoteStation: comp.remote || bstn,
    trainSourceStation: comp.from || bstn,
    jDate: comp.trainStartDate || q.jDate,
    chartType,
  }

  const vacant: Record<string, VacantBerth[] | null> = {}
  const errors: Record<string, string> = {}
  let stale = compR.stale
  let oldest = compR.at
  await Promise.all(
    classes.map(async (cls) => {
      try {
        const r = await post<{ vbd: VacantBerth[] | null; error?: string | null }>('vacantBerth', { ...base, cls })
        if (r.value.error && !isNoRecord(r.value.error)) errors[cls] = r.value.error
        vacant[cls] = r.value.vbd ?? []
        if (r.stale) stale = true
        oldest = Math.min(oldest, r.at)
      } catch (e) {
        errors[cls] = (e as Error).message
      }
    }),
  )

  return {
    composition: stale ? { ...comp, _stale: true } : comp,
    vacant,
    errors,
    stations: null,
    chartType,
    fetchedAt: new Date(oldest).toISOString(),
  }
}

export async function coachesDirect(q: {
  trainNo: string
  boardingStation: string
  remoteStation: string
  trainSourceStation: string
  jDate: string
  coaches: { coach: string; cls: string }[]
}, onProgress?: (done: number, total: number) => void): Promise<{ details: Record<string, CoachDetail>; errors: Record<string, string> }> {
  const details: Record<string, CoachDetail> = {}
  const errors: Record<string, string> = {}
  const { coaches, ...base } = q
  const tick = () => onProgress?.(Object.keys(details).length, coaches.length)
  tick()
  const run = async (list: { coach: string; cls: string }[], workers: number) => {
    const queue = [...list]
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          try {
            details[c.coach] = (await post<CoachDetail>('coachComposition', { ...base, coach: c.coach, cls: c.cls })).value
            delete errors[c.coach]
            tick()
          } catch (e) {
            errors[c.coach] = (e as Error).message
          }
        }
      }),
    )
  }
  // 4 at a time (the pacer spaces them out further if IRCTC pushes back)...
  await run(coaches, 4)
  // ...then one slow, single-file pass over anything that still failed.
  const failed = coaches.filter((c) => errors[c.coach])
  if (failed.length) {
    await sleep(jitter(3000))
    await run(failed, 1)
  }
  return { details, errors }
}
