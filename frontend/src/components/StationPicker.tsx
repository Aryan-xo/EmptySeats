import { useMemo, useState } from 'react'
import { rankStations } from '../fuzzy'
import { Combo } from './Combo'

interface Props {
  /** Selected station code ('' = none) */
  value: string
  /** Allowed stations in route order: [code, name] */
  stations: [string, string][]
  emptyLabel: string
  onChange: (code: string) => void
}

const label = ([c, n]: [string, string]) => (n ? `${n} (${c})` : c)

/**
 * Searchable station picker limited to one train's stops. Shows the whole list
 * (in route order) when focused, fuzzy-filters as you type.
 */
export function StationPicker({ value, stations, emptyLabel, onChange }: Props) {
  const current = stations.find(([c]) => c === value)
  const shown = current ? label(current) : ''
  const [text, setText] = useState<string | null>(null) // null = not editing

  const items = useMemo(() => {
    const q = text ?? ''
    const list = q && q !== shown ? rankStations(q, stations, 30) : stations
    return [
      ...(q && q !== shown ? [] : [{ value: '', primary: '—', secondary: emptyLabel }]),
      ...list.map(([c, n]) => ({ value: c, primary: c, secondary: n })),
    ]
  }, [text, stations, shown, emptyLabel])

  return (
    <div onBlur={() => setTimeout(() => setText(null), 150)}>
      <Combo
        value={text ?? shown}
        placeholder={emptyLabel}
        items={items}
        onChange={setText}
        onPick={(it) => {
          onChange(it.value)
          setText(null)
        }}
      />
    </div>
  )
}
