/**
 * Which stations a train stops at, known before any chart is fetched, so the search form can offer
 * only that train's stops.
 *
 * 1. 'exact':     the stop order worked out from coach charts on an earlier search in this browser
 * 2. 'timetable': public/routes.json, built from the open datameet/railways schedules (halts only,
 *                 renamed codes updated). It covers ~5,000 trains and can be out of date, so the form
 *                 always lets you fall back to searching every station.
 */
export type KnownRoute = { stations: string[]; source: 'exact' | 'timetable' }

const EXACT_KEY = (train: string) => `exact-route:${train}`

let timetable: Promise<Record<string, string>> | null = null

function loadTimetable(): Promise<Record<string, string>> {
  timetable ??= fetch('/routes.json')
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
    .catch(() => {
      timetable = null // try again next time
      return {}
    })
  return timetable
}

export async function knownRoute(trainNo: string): Promise<KnownRoute | null> {
  const train = trainNo.trim()
  if (!/^\d{4,5}$/.test(train)) return null
  try {
    const saved = JSON.parse(localStorage.getItem(EXACT_KEY(train)) ?? 'null') as string[] | null
    if (Array.isArray(saved) && saved.length >= 2) return { stations: saved, source: 'exact' }
  } catch {
    /* storage unavailable */
  }
  const stops = (await loadTimetable())[train]
  return stops ? { stations: stops.split(' '), source: 'timetable' } : null
}

/** Remember a train's exact stop order once coach charts have revealed it. */
export function saveExactRoute(trainNo: string, stations: string[]) {
  if (stations.length < 2) return
  try {
    localStorage.setItem(EXACT_KEY(trainNo.trim()), JSON.stringify(stations))
  } catch {
    /* storage full or unavailable */
  }
}
