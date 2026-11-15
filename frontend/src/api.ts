import type { ChartQuery, ChartResponse, CoachDetail, Train } from './types'

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
  chart: (q: ChartQuery) => req<ChartResponse>('/api/chart', q),
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
  coaches: (q: {
    trainNo: string
    boardingStation: string
    remoteStation: string
    trainSourceStation: string
    jDate: string
    coaches: { coach: string; cls: string }[]
    offline?: boolean
  }) => req<{ details: Record<string, CoachDetail>; errors: Record<string, string> }>('/api/coaches', q),
  importHar: (harText: string) =>
    req<{
      imported: Record<string, number>
      charts: { trainNo: string; jDate: string; boardingStation: string; trainName?: string }[]
    }>('/api/import/har', harText),
}
