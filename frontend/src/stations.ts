import { rankStations } from './fuzzy'
import names from './data/stations.json'

/** Station code → name, from the open datameet/railways dataset (+ recent renames). */
export const STATION_NAMES = names as Record<string, string>

export const stationName = (code: string) => STATION_NAMES[code?.toUpperCase()] ?? ''

/** "Gaya Jn (GAYA)" or just the code when unknown. */
export const stationLabel = (code: string) => {
  const n = stationName(code)
  return n ? `${n} (${code})` : code
}

const ENTRIES = Object.entries(STATION_NAMES)

/** Fuzzy search over all stations: codes, names, typos, abbreviations. */
export function searchStations(q: string, limit = 8): [string, string][] {
  return rankStations(q, ENTRIES, limit)
}
