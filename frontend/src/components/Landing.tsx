import { useMemo, useState } from 'react'
import { demoChart } from '../demo'
import { berthStatus, buildModel } from '../logic'
import { TrainStrip } from './TrainStrip'
import { CoachMap } from './CoachMap'
import { BerthPanel } from './BerthPanel'

/** Homepage for first-time visitors: a live, clickable preview plus the basics. */
export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <>
      <Showcase onStart={onStart} />
      <HowItWorks />
      <Features />
      <Faq />
    </>
  )
}

function Showcase({ onStart }: { onStart: () => void }) {
  const model = useMemo(() => buildModel(demoChart(), null, {}), [])
  const span = { a: model.idx.get('CNB')!, b: model.idx.get('HWH')! }
  const all = useMemo(() => [...model.berths.values()].flatMap((m) => [...m.values()]), [model])
  const freeAll = all.filter((b) => berthStatus(b, span) === 'free')
  const coachesWithFree = new Set(freeAll.map((b) => b.coach)).size

  const bestCoach = useMemo(() => {
    let best = model.coaches[0].coachName
    let n = -1
    for (const c of model.coaches) {
      const k = [...(model.berths.get(c.coachName)?.values() ?? [])].filter((b) => berthStatus(b, span) === 'free').length
      if (k > n) (best = c.coachName), (n = k)
    }
    return best
  }, [model])
  const [coach, setCoach] = useState(bestCoach)
  const firstFree = [...(model.berths.get(coach)?.values() ?? [])].find((b) => berthStatus(b, span) === 'free')
  const [berthNo, setBerthNo] = useState<number | null>(firstFree?.no ?? null)
  const cls = model.coaches.find((c) => c.coachName === coach)?.classCode ?? ''

  return (
    <section className="showcase" id="preview">
      <div className="sec-intro">
        <span className="eyebrow">See it in action</span>
        <h2>Your whole train, berth by berth</h2>
        <p>
          This is exactly what you get. Tap a coach, then any berth, to see where it's free. (Sample data, not a real
          train.)
        </p>
      </div>

      <div className="browser">
        <div className="browser-bar">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span className="url">localhost:8080/?train=00000&from=CNB&to=HWH</span>
          <span className="demo-pill">Interactive preview</span>
        </div>

        <div className="browser-body">
          <div className="demo-top">
            <div>
              <div className="eyebrow">Train 00000 · sample</div>
              <b className="demo-title">SAMPLE EXPRESS</b>
              <div className="muted small">Kanpur Central → Howrah Jn</div>
            </div>
            <div className="demo-stats">
              <div className="demo-stat good">
                <b>{freeAll.length}</b>
                <span>berths free all the way</span>
              </div>
              <div className="demo-stat">
                <b>{coachesWithFree}</b>
                <span>coaches with free berths</span>
              </div>
            </div>
          </div>

          <div className="demo-grid">
            <div className="demo-main">
              <TrainStrip
                model={model}
                span={span}
                classFilter={new Set()}
                selected={coach}
                onSelect={(c) => (setCoach(c), setBerthNo(null))}
              />
              <CoachMap
                model={model}
                coach={coach}
                cls={cls}
                span={span}
                detail={[]}
                selected={berthNo}
                onSelect={setBerthNo}
              />
            </div>
            <div className="demo-side">
              {berthNo != null ? (
                <BerthPanel
                  inline
                  model={model}
                  coach={coach}
                  cls={cls}
                  no={berthNo}
                  berth={model.berths.get(coach)?.get(berthNo)}
                  detail={undefined}
                  span={span}
                  onClose={() => setBerthNo(null)}
                />
              ) : (
                <div className="card placeholder">
                  <div className="ph-icon">👆</div>
                  <b>Tap a berth</b>
                  <p className="muted small">Its full journey shows up here.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="float-card f1">
          <span className="fc-icon">✅</span>
          <div>
            <b>{freeAll.length} free</b>
            <small>for the whole trip</small>
          </div>
        </div>
        <div className="float-card f2">
          <span className="fc-icon">🔀</span>
          <div>
            <b>Split journey</b>
            <small>hop between berths</small>
          </div>
        </div>
      </div>

      <div className="center cta-row">
        <button className="primary big cta" onClick={onStart}>
          Try it with your train →
        </button>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    ['Search your train', 'Type the train number or name, the date, and where you get on and off. Typos are fine.'],
    ['Get a straight answer', 'See how many berths are free for your whole trip, or a plan that hops between berths.'],
    ['Explore any berth', 'Tap a coach and a berth to see every stretch where it is free, booked, and under which quota.'],
  ]
  return (
    <section className="how" id="how">
      <div className="sec-intro">
        <span className="eyebrow">How it works</span>
        <h2>Three steps, about ten seconds</h2>
      </div>
      <ol className="how-steps">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className="how-num">{i + 1}</span>
            <b>{t}</b>
            <p className="muted">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Features() {
  const list = [
    ['🛤️', 'Exact stop-by-stop route', 'Built from every coach’s chart, so “free from A to B” is accurate to the station.'],
    ['🔀', 'Split-journey finder', 'No single berth free the whole way? We chain berths with the fewest changes.'],
    ['🏷️', 'Quotas & berth types', 'Lower, upper, side berths, and the quota each booked stretch belongs to.'],
    ['🔎', 'Forgiving search', 'Find stations by name, code, old name, or with typos: “bombay”, “nasik raod”.'],
    ['⚡', 'Live charts', 'Straight from IRCTC’s public reservation charts, refreshed whenever you want.'],
    ['📱', 'Works on your phone', 'Designed for the platform: big tap targets, bottom-sheet berth details.'],
  ]
  return (
    <section className="features">
      <div className="sec-intro">
        <span className="eyebrow">Why it helps</span>
        <h2>Everything the official chart doesn’t tell you</h2>
      </div>
      <div className="feature-grid">
        {list.map(([i, t, d]) => (
          <div className="feature" key={t}>
            <span className="feature-icon">{i}</span>
            <b>{t}</b>
            <p className="muted small">{d}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Faq() {
  const qs = [
    [
      'When do charts become available?',
      'IRCTC prepares the first chart the night before (around 8 PM, 9 PM in some zones) for trains leaving between 5 AM and 2 PM, and about 10 hours before departure for all other trains. The final chart comes 30 minutes before departure. Before that there is nothing to show.',
    ],
    [
      'Can I book a berth I see here?',
      'Berths left vacant after charting are released to “current booking” on IRCTC and at station counters, or can be allotted on board by the TTE. This app only shows availability; it doesn’t book anything.',
    ],
    [
      'Why isn’t my station in the “To” list?',
      'The chart only lists stations where a berth changes hands. If yours isn’t there, pick the nearest stop after it: a berth free until then is free for you too.',
    ],
    [
      'Which date should I pick?',
      'The date your train leaves your boarding station. The app works out the train’s start date for you.',
    ],
    ['Is this official?', 'No. It is an independent tool that reads IRCTC’s publicly available reservation charts.'],
  ]
  return (
    <section className="faq" id="faq">
      <div className="sec-intro">
        <span className="eyebrow">Questions</span>
        <h2>Good to know</h2>
      </div>
      <div className="faq-list">
        {qs.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
