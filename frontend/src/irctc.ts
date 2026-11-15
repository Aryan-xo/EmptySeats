/**
 * Talk to IRCTC's public chart API straight from the visitor's browser.
 *
 * IRCTC answers these endpoints with `Access-Control-Allow-Origin: *`, and the request then
 * comes from the visitor's own browser and network, exactly like opening irctc.co.in.
 * Cloud servers (e.g. Vercel) often get 403 from IRCTC's CDN, so this is the preferred path
 * when hosted. Mirrors the Rust backend's /api/chart and /api/coaches.
 */
import type { ChartQuery, ChartResponse, CoachDetail, Composition, VacantBerth } from './types'

const BASE = 'https://www.irctc.co.in/online-charts/api/'
const TTL = 2 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

export class IrctcHttpError extends Error {}

async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const key = endpoint + JSON.stringify(body)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as T

  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new IrctcHttpError(`IRCTC returned HTTP ${res.status}`)
  if (!text.trim()) throw new IrctcHttpError('IRCTC returned an empty response')
  const value = JSON.parse(text) as T
  cache.set(key, { at: Date.now(), value })
  return value
}

const isNoRecord = (e: unknown) => typeof e === 'string' && e.trim().toLowerCase() === 'no record found'

export async function chartDirect(q: ChartQuery): Promise<ChartResponse> {
  const trainNo = q.trainNo.trim()
  const bstn = q.boardingStation.trim().toUpperCase()
  const comp = await post<Composition>('trainComposition', { trainNo, jDate: q.jDate, boardingStation: bstn })
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
  await Promise.all(
    classes.map(async (cls) => {
      try {
        const v = await post<{ vbd: VacantBerth[] | null; error?: string | null }>('vacantBerth', { ...base, cls })
        if (v.error && !isNoRecord(v.error)) errors[cls] = v.error
        vacant[cls] = v.vbd ?? []
      } catch (e) {
        errors[cls] = (e as Error).message
      }
    }),
  )

  return { composition: comp, vacant, errors, stations: null, chartType, fetchedAt: new Date().toISOString() }
}

export async function coachesDirect(q: {
  trainNo: string
  boardingStation: string
  remoteStation: string
  trainSourceStation: string
  jDate: string
  coaches: { coach: string; cls: string }[]
}): Promise<{ details: Record<string, CoachDetail>; errors: Record<string, string> }> {
  const details: Record<string, CoachDetail> = {}
  const errors: Record<string, string> = {}
  const queue = [...q.coaches]
  const { coaches: _ignored, ...base } = q
  // 4 at a time, like the backend: polite to IRCTC, still reasonably quick.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          details[c.coach] = await post<CoachDetail>('coachComposition', { ...base, coach: c.coach, cls: c.cls })
        } catch (e) {
          errors[c.coach] = (e as Error).message
        }
      }
    }),
  )
  return { details, errors }
}
