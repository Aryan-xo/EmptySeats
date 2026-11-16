import type { ChartQuery, ChartResponse, CoachDetail, Train } from './types'
import { chartDirect, coachesDirect, IrctcPausedError } from './irctc'

/**
 * Where live chart data comes from:
 * - 'browser': the visitor's browser calls IRCTC directly (works when hosted on cloud IPs IRCTC blocks)
 * - 'server':  our Rust backend calls IRCTC (works locally; needed for HAR/offline data)
 * We try the browser first, and fall back to the server once if it fails.
 */
export type Source = 'browser' | 'server'
let source: Source | null = null
export const getSource = () => source

type CoachesQuery = {
  trainNo: string
  boardingStation: string
  remoteStation: string
  trainSourceStation: string
  jDate: string
  coaches: { coach: string; cls: string }[]
  offline?: boolean
}

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Backend returned non-JSON (${res.status})`)
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export const api = {
  trains: () => req<Train[]>('/api/trains'),
  chart: async (q: ChartQuery): Promise<ChartResponse> => {
    if (q.offline) return req<ChartResponse>('/api/chart', q)
    let browserErr: unknown = null
    if (source !== 'server') {
      try {
        const res = await chartDirect(q)
        source = 'browser'
        return res
      } catch (e) {
        browserErr = e
        console.info('[EmptySeats] direct IRCTC fetch failed, using server:', e)
      }
    }
    try {
      const res = await req<ChartResponse>('/api/chart', q)
      source = 'server'
      return res
    } catch (e) {
      // Your network is blocked: say that, not the server's (expected) cloud-IP refusal.
      if (browserErr instanceof IrctcPausedError) throw browserErr
      throw new Error(`${(e as Error).message} (tried your browser and our server)`)
    }
  },
  coach: (q: {
    trainNo: string
    boardingStation: string
    remoteStation: string
    trainSourceStation: string
    jDate: string
    coach: string
    cls: string
    offline?: boolean
  }) => req<CoachDetail>('/api/coach', q),
  coaches: (
    q: CoachesQuery,
    onProgress?: (done: number, total: number) => void,
    onCoach?: (coach: string, detail: CoachDetail) => void,
  ) =>
    !q.offline && source === 'browser'
      ? coachesDirect(q, onProgress, onCoach)
      : req<{ details: Record<string, CoachDetail>; errors: Record<string, string> }>('/api/coaches', q),
  importHar: (harText: string) =>
    req<{
      imported: Record<string, number>
      charts: { trainNo: string; jDate: string; boardingStation: string; trainName?: string }[]
    }>('/api/import/har', harText),
}
