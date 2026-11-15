export interface Train {
  number: string
  name: string
}

export interface CoachInfo {
  coachName: string
  classCode: string
  positionFromEngine: number
  vacantBerths: number
}

export interface Composition {
  cdd: CoachInfo[]
  trainNo: string
  trainName: string
  from: string
  to: string
  trainStartDate: string
  remoteLocationChartDate?: string
  remote: string
  nextRemote?: string | null
  avlRemoteForBooking?: string | null
  destinationStation?: string | null
  chartOneDate?: string | null
  chartTwoDate?: string | null
  error: string | null
  _stale?: boolean
}

export interface VacantBerth {
  coachName: string
  berthCode: string
  berthNumber: number
  from: string
  to: string
  splitNo: number
}

export interface Station {
  stationCode: string
  stationName?: string
  arrivalTime?: string
  departureTime?: string
  dayCount?: string | number
}

export interface ChartResponse {
  composition: Composition
  vacant: Record<string, VacantBerth[] | null>
  errors: Record<string, string>
  stations: Station[] | null
  chartType: number
  fetchedAt: string
  error?: string
}

export interface ChartQuery {
  trainNo: string
  jDate: string
  boardingStation: string
  /** where the traveller gets off (UI only) */
  to?: string
  offline?: boolean
}

/** Loosely-typed coachComposition response: we read it defensively. */
export type CoachDetail = Record<string, unknown>
