import { useMemo, useRef, useState } from 'react'
import type { ChartQuery, Train } from '../types'
import { searchStations, stationName } from '../stations'
import { Combo, type ComboItem } from './Combo'

export interface Recent {
  trainNo: string
  trainName: string
  boardingStation: string
  to?: string
}

interface Props {
  trains: Train[]
  initial: ChartQuery
  recent: Recent[]
  loading: boolean
  offline: boolean
  autoRefresh: boolean
  onOffline: (v: boolean) => void
  onAutoRefresh: (v: boolean) => void
  onSubmit: (q: ChartQuery) => void
  onImport: (file: File) => void
}

const iso = (d: Date) => d.toLocaleDateString('en-CA')
const shift = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return iso(d)
}

/** Train names often start with the source code ("PNBE CSMT SF EX"). */
function guessSource(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return /^[A-Z]{2,5}$/.test(first) && stationName(first) ? first : ''
}

const stationItems = (q: string): ComboItem[] =>
  searchStations(q).map(([code, name]) => ({ value: code, primary: code, secondary: name }))

export function SearchForm(p: Props) {
  const [train, setTrain] = useState(p.initial.trainNo)
  const [date, setDate] = useState(p.initial.jDate)
  const [from, setFrom] = useState(p.initial.boardingStation)
  const [to, setTo] = useState(p.initial.to ?? '')
  const fileRef = useRef<HTMLInputElement>(null)

  const trainItems = useMemo((): ComboItem[] => {
    const q = train.trim().toUpperCase()
    if (!q) return []
    return p.trains
      .filter((t) => t.number.startsWith(q) || t.name.toUpperCase().includes(q))
      .slice(0, 10)
      .map((t) => ({ value: t.number, primary: t.number, secondary: t.name }))
  }, [train, p.trains])

  const picked = p.trains.find((t) => t.number === train.trim())
  const submit = (q: ChartQuery) => p.onSubmit(q)

  return (
    <form
      className="card search"
      onSubmit={(e) => {
        e.preventDefault()
        submit({ trainNo: train.trim(), jDate: date, boardingStation: from.trim(), to: to.trim() || undefined })
      }}
    >
      <div className="search-grid">
        <label className="field f-train">
          <span>Train</span>
          <Combo
            value={train}
            onChange={setTrain}
            items={trainItems}
            placeholder="Number or name"
            required
            onPick={(it) => {
              setTrain(it.value)
              if (!from) setFrom(guessSource(it.secondary ?? ''))
            }}
          />
          <small className="hint">{picked?.name ?? 'e.g. 12321 or "Mumbai Mail"'}</small>
        </label>

        <label className="field f-date">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <div className="quick">
            {[
              ['Yesterday', -1],
              ['Today', 0],
              ['Tomorrow', 1],
            ].map(([l, d]) => (
              <button
                type="button"
                key={l}
                className={date === shift(d as number) ? 'on' : ''}
                onClick={() => setDate(shift(d as number))}
              >
                {l}
              </button>
            ))}
          </div>
        </label>

        <label className="field f-stn">
          <span>From (boarding)</span>
          <Combo
            value={from}
            onChange={setFrom}
            items={stationItems(from)}
            placeholder="Station or code"
            required
            uppercase
            onPick={(it) => setFrom(it.value)}
          />
          <small className="hint">{stationName(from) || ' '}</small>
        </label>

        <label className="field f-stn">
          <span>To</span>
          <Combo
            value={to}
            onChange={setTo}
            items={stationItems(to)}
            placeholder="Optional"
            uppercase
            onPick={(it) => setTo(it.value)}
          />
          <small className="hint">{stationName(to) || ' '}</small>
        </label>

        <div className="f-go">
          <button type="submit" className="primary big" disabled={p.loading}>
            {p.loading ? <span className="spinner" /> : null}
            {p.loading ? 'Searching…' : 'Find empty berths'}
          </button>
        </div>
      </div>

      <div className="search-foot">
        {p.recent.length > 0 && (
          <div className="recent">
            <span className="muted small">Recent</span>
            {p.recent.map((r) => (
              <button
                type="button"
                key={`${r.trainNo}-${r.boardingStation}-${r.to ?? ''}`}
                className="recent-chip"
                onClick={() => {
                  setTrain(r.trainNo)
                  setFrom(r.boardingStation)
                  setTo(r.to ?? '')
                  submit({ trainNo: r.trainNo, jDate: date, boardingStation: r.boardingStation, to: r.to })
                }}
              >
                <b>{r.trainNo}</b> {r.boardingStation}
                {r.to ? ` → ${r.to}` : ''}
              </button>
            ))}
          </div>
        )}
        <details className="more">
          <summary>More options</summary>
          <div className="more-body">
            <button type="button" onClick={() => fileRef.current?.click()}>
              Import HAR file…
            </button>
            <label>
              <input type="checkbox" checked={p.offline} onChange={(e) => p.onOffline(e.target.checked)} /> Use
              imported data only
            </label>
            <label>
              <input type="checkbox" checked={p.autoRefresh} onChange={(e) => p.onAutoRefresh(e.target.checked)} />{' '}
              Auto-refresh every 5 min
            </label>
          </div>
        </details>
        <input
          ref={fileRef}
          type="file"
          accept=".har,.json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) p.onImport(f)
            e.target.value = ''
          }}
        />
      </div>
    </form>
  )
}
