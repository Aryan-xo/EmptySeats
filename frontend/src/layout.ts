/** Physical coach layouts used to draw seat maps. */

export type LayoutKind = 'sleeper8' | 'sleeper6' | 'cabin4' | 'seats'

export interface LayoutSpec {
  kind: LayoutKind
  capacity: number
  /** seats layout only: seats per row and where the aisle goes (after index) */
  perRow?: number
  aisleAfter?: number
}

const SPECS: Record<string, LayoutSpec> = {
  SL: { kind: 'sleeper8', capacity: 72 },
  '3A': { kind: 'sleeper8', capacity: 72 },
  '3E': { kind: 'sleeper8', capacity: 80 },
  '2A': { kind: 'sleeper6', capacity: 48 },
  '1A': { kind: 'cabin4', capacity: 24 },
  FC: { kind: 'cabin4', capacity: 26 },
  CC: { kind: 'seats', capacity: 78, perRow: 5, aisleAfter: 3 },
  EC: { kind: 'seats', capacity: 56, perRow: 4, aisleAfter: 2 },
  EA: { kind: 'seats', capacity: 44, perRow: 4, aisleAfter: 2 },
  EV: { kind: 'seats', capacity: 44, perRow: 4, aisleAfter: 2 },
  VS: { kind: 'seats', capacity: 44, perRow: 4, aisleAfter: 2 },
  '2S': { kind: 'seats', capacity: 108, perRow: 6, aisleAfter: 3 },
}

export function layoutFor(cls: string, maxBerthSeen: number): LayoutSpec {
  const base = SPECS[cls] ?? { kind: 'seats', capacity: 72, perRow: 5, aisleAfter: 3 }
  const unit = base.kind === 'sleeper8' ? 8 : base.kind === 'sleeper6' ? 6 : base.kind === 'cabin4' ? 4 : (base.perRow ?? 5)
  const cap = Math.max(base.capacity, Math.ceil(maxBerthSeen / unit) * unit)
  return { ...base, capacity: cap }
}

const SL8 = ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU']
const SL6 = ['LB', 'UB', 'LB', 'UB', 'SL', 'SU']

/** Berth code from the API, or derived from the standard numbering pattern. */
export function berthCode(cls: string, no: number, apiCode?: string): string {
  const api = apiCode?.trim().toUpperCase()
  // coachComposition uses one-letter codes: L/M/U lower/middle/upper, R/P side lower/upper.
  if (api) return ({ L: 'LB', M: 'MB', U: 'UB', R: 'SL', P: 'SU' } as Record<string, string>)[api] ?? api
  const spec = SPECS[cls]
  switch (spec?.kind) {
    case 'sleeper8':
      return SL8[(no - 1) % 8]
    case 'sleeper6':
      return SL6[(no - 1) % 6]
    case 'cabin4':
      return no % 2 ? 'LB' : 'UB'
    case 'seats': {
      const per = spec.perRow ?? 5
      const pos = (no - 1) % per
      if (pos === 0 || pos === per - 1) return 'WS'
      if (pos === (spec.aisleAfter ?? 3) - 1 || pos === spec.aisleAfter) return 'AS'
      return 'MS'
    }
    default:
      return ''
  }
}

export const CODE_NAMES: Record<string, string> = {
  LB: 'Lower',
  MB: 'Middle',
  UB: 'Upper',
  SL: 'Side lower',
  SU: 'Side upper',
  WS: 'Window',
  MS: 'Middle',
  AS: 'Aisle',
}
