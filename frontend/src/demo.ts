import type { ChartResponse, VacantBerth } from './types'
import { stationName } from './stations'

/**
 * Sample chart for the homepage preview. Deterministic (seeded), clearly fake
 * train number, real station names so it reads naturally.
 */
const ROUTE = ['NDLS', 'CNB', 'PRYJ', 'DDU', 'GAYA', 'DHN', 'ASN', 'HWH']
const COACHES: [string, string, number][] = [
  ['H1', '1A', 24],
  ['A1', '2A', 48],
  ['A2', '2A', 48],
  ['B1', '3A', 72],
  ['B2', '3A', 72],
  ['B3', '3A', 72],
  ['B4', '3A', 72],
  ['S1', 'SL', 72],
  ['S2', 'SL', 72],
  ['S3', 'SL', 72],
]

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

export function demoChart(): ChartResponse {
  const r = rng(42)
  const vacant: Record<string, VacantBerth[]> = {}
  const last = ROUTE.length - 1
  for (const [coach, cls, cap] of COACHES) {
    const share = cls === 'SL' ? 0.16 : cls === '3A' ? 0.22 : 0.18
    for (let no = 1; no <= cap; no++) {
      if (r() > share) continue
      // Most vacancies start early; some are free for the whole run, some get split.
      const a = r() < 0.6 ? 1 : Math.floor(r() * (last - 1)) + 1
      const b = r() < 0.45 ? last : Math.min(last, a + 1 + Math.floor(r() * 3))
      const list = (vacant[cls] ??= [])
      list.push({ coachName: coach, berthCode: ' ', berthNumber: no, from: ROUTE[a], to: ROUTE[b], splitNo: 1 })
      if (b < last - 1 && r() < 0.35)
        list.push({ coachName: coach, berthCode: ' ', berthNumber: no, from: ROUTE[b + 1], to: ROUTE[last], splitNo: 2 })
    }
  }
  return {
    composition: {
      cdd: COACHES.map(([coachName, classCode]) => ({ coachName, classCode, positionFromEngine: 0, vacantBerths: 0 })),
      trainNo: '00000',
      trainName: 'SAMPLE EXPRESS',
      from: 'NDLS',
      to: 'HWH',
      trainStartDate: '2026-01-01',
      remote: 'CNB',
      nextRemote: 'DDU',
      destinationStation: 'HWH',
      chartOneDate: '2026-01-01 16:00:00',
      chartTwoDate: '2026-01-01 19:30:00',
      error: null,
    },
    vacant,
    errors: {},
    stations: ROUTE.map((s) => ({ stationCode: s, stationName: stationName(s) })),
    chartType: 2,
    fetchedAt: new Date().toISOString(),
  }
}
