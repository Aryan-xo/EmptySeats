import { useState } from 'react'
import type { Berth, DetailBerth, Interval, Model } from '../logic'
import { berthBlocks, berthStatus } from '../logic'
import { CODE_NAMES, berthCode } from '../layout'
import { stationName } from '../stations'

interface Props {
  model: Model
  coach: string
  cls: string
  no: number
  berth: Berth | undefined
  detail: DetailBerth | undefined
  span: Interval | null
  onClose: () => void
  /** Inline preview: no bottom-sheet behaviour on phones, no share button. */
  inline?: boolean
}

const QUOTAS: Record<string, string> = {
  GN: 'General',
  TQ: 'Tatkal',
  PT: 'Premium Tatkal',
  LD: 'Ladies',
  SS: 'Senior citizen',
  HP: 'Divyang',
  DF: 'Defence',
  FT: 'Foreign tourist',
  RC: 'RAC',
  RS: 'Roadside',
  YU: 'Yuva',
  PH: 'Parliament',
  HO: 'Headquarters',
}

/** One berth's whole journey: where it's free and where someone has it. */
export function BerthPanel({ model, coach, cls, no, berth, detail, span, onClose, inline }: Props) {
  const [copied, setCopied] = useState(false)
  const code = berthCode(cls, no, berth?.code || detail?.code)
  const blocks = berthBlocks(model, berth, detail)
  const status = berthStatus(berth, span)
  const name = (s: string) => model.names[s] || stationName(s)

  const verdict = !berth
    ? { cls: 'bad', text: 'Occupied for the whole charted journey' }
    : !span
      ? { cls: 'good', text: `Free on ${blocks.filter((b) => b.state === 'free').length} stretch(es)` }
      : status === 'free'
        ? { cls: 'good', text: 'Free for your whole trip' }
        : status === 'partial'
          ? { cls: 'warn', text: 'Free for part of your trip' }
          : { cls: 'bad', text: 'Not free on your trip' }

  const copyLink = async () => {
    const u = new URL(location.href)
    u.searchParams.set('coach', coach)
    u.searchParams.set('berth', String(no))
    try {
      await navigator.clipboard.writeText(u.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  const inTrip = (a: number, b: number) => !!span && a < span.b && b > span.a

  return (
    <div className={`card berth-panel ${inline ? 'inline' : 'open'}`}>
      <div className="panel-head">
        <div>
          <div className="eyebrow">
            Coach {coach} · {cls}
          </div>
          <h3>
            Berth {no} <span className="code-pill">{code}</span>
          </h3>
          <div className="muted small">{CODE_NAMES[code] ?? code} berth</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={`verdict ${verdict.cls}`}>{verdict.text}</div>

      {blocks.length > 0 && (
        <ol className="vt">
          {blocks.map((bl, i) => {
            const a = model.stations[bl.a]
            const b = model.stations[bl.b]
            return (
              <li key={i} className={`vt-item ${bl.state} ${inTrip(bl.a, bl.b) ? 'trip' : ''}`}>
                {i === 0 && <Stop code={a} name={name(a)} mark={span?.a === bl.a ? 'Board' : undefined} />}
                <div className="vt-seg">
                  <span className="vt-line" />
                  <span className="vt-label">
                    {bl.state === 'free' ? 'Free' : bl.state === 'taken' ? 'Booked' : 'Unknown'}
                    {bl.quota && bl.state !== 'free' && (
                      <small className="muted"> · {QUOTAS[bl.quota] ?? bl.quota} quota</small>
                    )}
                  </span>
                </div>
                <Stop
                  code={b}
                  name={name(b)}
                  mark={span?.a === bl.b ? 'Board' : span?.b === bl.b ? 'Get off' : undefined}
                />
              </li>
            )
          })}
        </ol>
      )}

      {!inline && <div className="panel-actions">
        <button onClick={copyLink}>{copied ? 'Link copied ✓' : 'Copy link to this berth'}</button>
      </div>}
    </div>
  )
}

function Stop({ code, name, mark }: { code: string; name: string; mark?: string }) {
  return (
    <div className="vt-stop">
      <span className="vt-dot" />
      <span className="vt-code">{code}</span>
      <span className="vt-name">{name}</span>
      {mark && <span className="vt-mark">{mark}</span>}
    </div>
  )
}
