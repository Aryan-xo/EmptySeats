/**
 * Fuzzy station matching. Higher score = better; -1 = no match.
 *
 * Handles: exact/prefix codes, word prefixes ("nas ro" → Nasik Road), substrings,
 * typos ("mumbia", "nasik raod"), missing spaces ("nasikroad") and in-order
 * letters ("gyjn" → Gaya Jn).
 */

const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/JUNCTION/g, 'JN')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Edit distance (adjacent swaps count as 1 edit), with an early exit once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let pp: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1)
      cur.push(v)
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return max + 1
    pp = prev
    prev = cur
  }
  return prev[b.length]
}

/** Letters of q appear in s in order; returns how spread out they are (lower = tighter). */
function subsequenceSpread(q: string, s: string): number {
  let i = 0
  let first = -1
  let last = -1
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      if (first < 0) first = j
      last = j
      i++
    }
  }
  return i === q.length ? last - first + 1 - q.length : -1
}

/** Each query word matches the start of some name word, in order ("nas ro" → "NASIK ROAD"). */
function wordPrefixes(qWords: string[], words: string[]): boolean {
  let w = 0
  for (const qw of qWords) {
    while (w < words.length && !words[w].startsWith(qw)) w++
    if (w === words.length) return false
    w++
  }
  return true
}

interface Prepared {
  code: string
  n: string
  nNoSpace: string
  words: string[]
  penalty: number
}

/** Cabins, goods sheds, yards… exist in the dataset but are rarely what people want. */
const NOISE = /\b(CABIN|GOODS|YARD|MARSHALING|MARSHALLING|SIDING|NG|BLOCK HUT|HALT)\b/

/** Old / popular names people still type, keyed by station code. */
const ALIASES: Record<string, string> = {
  SBC: 'BANGALORE BENGALURU CITY',
  KSR: 'BANGALORE BENGALURU CITY',
  SMVB: 'BANGALORE BENGALURU BAIYAPPANAHALLI',
  YPR: 'BANGALORE YESVANTPUR',
  CSMT: 'BOMBAY VT VICTORIA TERMINUS CST',
  MMCT: 'BOMBAY CENTRAL',
  HWH: 'CALCUTTA KOLKATA',
  SDAH: 'CALCUTTA KOLKATA',
  KOAA: 'CALCUTTA CHITPUR',
  MAS: 'MADRAS CHENNAI CENTRAL',
  MS: 'MADRAS CHENNAI EGMORE',
  PRYJ: 'ALLAHABAD',
  DDU: 'MUGHALSARAI MUGHAL SARAI DEEN DAYAL',
  BSB: 'BANARAS KASHI BENARES',
  TVC: 'TRIVANDRUM',
  ERS: 'COCHIN KOCHI ERNAKULAM',
  GHY: 'GAUHATI',
  VSKP: 'VIZAG',
  NDLS: 'DELHI',
  PUNE: 'POONA',
  RKMP: 'HABIBGANJ BHOPAL',
  AY: 'AYODHYA FAIZABAD',
}

/** Small boost for the stations people usually mean (junctions, terminals, centrals). */
const MAJOR = /\b(JN|CENTRAL|TERMINUS|TERMINAL|CANTT|CITY)\b/

function prepare(code: string, name: string): Prepared {
  const c = code.toUpperCase()
  const n = norm(name)
  const full = ALIASES[c] ? `${n} ${ALIASES[c]}` : n
  return {
    code: c,
    n,
    nNoSpace: n.replace(/ /g, ''),
    words: full.split(' '),
    penalty: NOISE.test(n) ? 500 : MAJOR.test(n) ? -5 : 0,
  }
}

function score(q: string, p: Prepared): number {
  const raw = rawScore(q, p)
  return raw < 0 ? raw : raw - p.penalty
}

/** `q` must already be normalised with norm(). */
function rawScore(q: string, p: Prepared): number {
  if (!q) return -1
  const { code: c, n, nNoSpace, words } = p
  const qNoSpace = q.replace(/ /g, '')

  if (c === qNoSpace) return 1000
  if (c.startsWith(qNoSpace)) return 900 - c.length
  if (n === q) return 880
  if (words.includes(q)) return 870 - words.length
  if (n.startsWith(q)) return 860 - n.length / 100

  const qWords = q.split(' ')
  if (qWords.length > 1 && wordPrefixes(qWords, words)) return 820
  if (words.some((w) => w.startsWith(q))) return 780
  if (n.includes(q)) return 700
  if (nNoSpace.includes(qNoSpace)) return 650

  // Typos: compare with the start of each word (and joined words), allowing 1–2 edits.
  if (qNoSpace.length >= 3) {
    const max = qNoSpace.length >= 7 ? 2 : 1
    let best = max + 1
    const targets = [nNoSpace, ...words, ...words.slice(1).map((_, i) => words.slice(i).join(''))]
    for (const t of targets)
      best = Math.min(
        best,
        editDistance(qNoSpace, t.slice(0, qNoSpace.length), max),
        editDistance(qNoSpace, t.slice(0, qNoSpace.length + 1), max),
      )
    if (best <= max) return 500 - best * 60
    if (c.length >= 3 && editDistance(qNoSpace, c, 1) <= 1) return 420
  }

  // Letters in order: "gyjn" → "GAYA JN"
  if (qNoSpace.length >= 2) {
    const spread = subsequenceSpread(qNoSpace, nNoSpace)
    if (spread >= 0 && spread <= qNoSpace.length * 3) return 300 - spread
  }
  return -1
}

export function scoreStation(query: string, code: string, name: string): number {
  return score(norm(query), prepare(code, name))
}

const cache = new WeakMap<[string, string][], Prepared[]>()

export function rankStations(query: string, entries: [string, string][], limit: number): [string, string][] {
  let prepared = cache.get(entries)
  if (!prepared) {
    prepared = entries.map(([c, n]) => prepare(c, n))
    cache.set(entries, prepared)
  }
  const q = norm(query)
  if (!q) return []
  const scored: { i: number; s: number }[] = []
  for (let i = 0; i < prepared.length; i++) {
    const s = score(q, prepared[i])
    if (s >= 0) scored.push({ i, s })
  }
  scored.sort((a, b) => b.s - a.s || entries[a.i][1].length - entries[b.i][1].length)
  return scored.slice(0, limit).map((x) => entries[x.i])
}
