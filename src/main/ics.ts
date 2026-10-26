/**
 * 캘린더 ICS 파일에서 일정을 읽는다. 구글·Outlook이 내보내는 형식에서 실제로 쓰이는 것만 다룬다.
 *  - DTSTART: UTC(Z), TZID 지정, 날짜만(종일)
 *  - RRULE: DAILY·WEEKLY(BYDAY)·MONTHLY(같은 날짜)·YEARLY, INTERVAL, COUNT, UNTIL
 *  - EXDATE, RECURRENCE-ID(반복 중 한 번만 바뀐 일정)
 */

export interface Occurrence {
  uid: string
  title: string
  start: number // ms
  allDay: boolean
}

interface Wall { y: number; m: number; d: number; h: number; mi: number; s: number }

interface VEvent {
  uid: string
  title: string
  wall: Wall
  tz: string | null // null 이면 UTC, 'local' 이면 이 컴퓨터 시간대
  allDay: boolean
  rrule: Record<string, string> | null
  exdates: Set<number>
  recurrenceId: number | null
  cancelled: boolean
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MAX_STEPS = 20000

/** tz 시간대의 벽시계 시각을 UTC ms 로. 모르는 시간대면 이 컴퓨터 시간대로 본다. */
export function wallToUtc(w: Wall, tz: string | null): number {
  if (tz === null) return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
  if (tz === 'local') return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime()
  try {
    // 같은 순간이 그 시간대에서 몇 시로 보이는지 재서 차이(오프셋)를 뺀다. 서머타임 경계 때문에 한 번 더 맞춘다.
    const offset = (t: number) => tzWallAsUtc(t, tz) - t
    let t = guess - offset(guess)
    t = guess - offset(t)
    return t
  } catch {
    return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime()
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function tzWallAsUtc(t: number, tz: string): number {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(new Date(t))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

function parseValue(v: string): { wall: Wall; utc: boolean; dateOnly: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v.trim())
  if (!m) return null
  return {
    wall: { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) },
    utc: !!m[7],
    dateOnly: m[4] === undefined,
  }
}

function paramsOf(name: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of name.split(';').slice(1)) {
    const [k, ...rest] = p.split('=')
    out[k.toUpperCase()] = rest.join('=').replace(/^"|"$/g, '')
  }
  return out
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

/** 한 속성 값(DTSTART, EXDATE 등)을 UTC ms 로 */
function timeOf(name: string, value: string): { ms: number; wall: Wall; tz: string | null; dateOnly: boolean } | null {
  const v = parseValue(value)
  if (!v) return null
  const tzid = paramsOf(name)['TZID']
  const tz = v.utc ? null : v.dateOnly ? 'local' : tzid || 'local'
  return { ms: wallToUtc(v.wall, tz), wall: v.wall, tz, dateOnly: v.dateOnly }
}

export function parseIcs(text: string): VEvent[] {
  // 75자마다 줄을 접는 규칙(다음 줄이 공백으로 시작)을 먼저 편다.
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const events: VEvent[] = []
  let cur: Partial<VEvent> | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: new Set(), rrule: null, recurrenceId: null, title: '(제목 없음)', uid: '', cancelled: false }
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur?.wall) events.push(cur as VEvent)
      cur = null
      continue
    }
    if (!cur) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const name = line.slice(0, idx)
    const value = line.slice(idx + 1)
    const key = name.split(';')[0].toUpperCase()

    if (key === 'UID') cur.uid = value.trim()
    else if (key === 'SUMMARY') cur.title = unescapeText(value) || '(제목 없음)'
    else if (key === 'STATUS') cur.cancelled = value.trim().toUpperCase() === 'CANCELLED'
    else if (key === 'DTSTART') {
      const t = timeOf(name, value)
      if (t) { cur.wall = t.wall; cur.tz = t.tz; cur.allDay = t.dateOnly }
    } else if (key === 'RRULE') {
      cur.rrule = Object.fromEntries(value.split(';').map((kv) => {
        const [k, v] = kv.split('=')
        return [k.toUpperCase(), (v ?? '').toUpperCase()]
      }))
    } else if (key === 'EXDATE') {
      for (const v of value.split(',')) {
        const t = timeOf(name, v)
        if (t) cur.exdates!.add(t.ms)
      }
    } else if (key === 'RECURRENCE-ID') {
      const t = timeOf(name, value)
      if (t) cur.recurrenceId = t.ms
    }
  }
  return events
}

function addDays(w: Wall, n: number): Wall {
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n))
  return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

function weekday(w: Wall): number {
  return new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay()
}

/** 반복 일정의 n번째 후보 벽시계 시각들을 차례로 내놓는다. */
function* candidates(e: VEvent): Generator<Wall> {
  const r = e.rrule
  if (!r) { yield e.wall; return }
  const interval = Math.max(1, Number(r['INTERVAL']) || 1)
  const freq = r['FREQ']

  if (freq === 'WEEKLY') {
    const days = (r['BYDAY'] || DAY_CODES[weekday(e.wall)]).split(',')
      .map((c) => DAY_CODES.indexOf(c.slice(-2))).filter((i) => i >= 0)
    // 시작한 주의 일요일을 기준으로 몇 번째 주인지 센다.
    const weekStart = addDays(e.wall, -weekday(e.wall))
    for (let i = 0; i < MAX_STEPS; i++) {
      const w = addDays(weekStart, i)
      if (Math.floor(i / 7) % interval !== 0) continue
      if (!days.includes(weekday(w))) continue
      if (i < weekday(e.wall)) continue
      yield w
    }
    return
  }
  for (let i = 0; i < MAX_STEPS; i++) {
    if (freq === 'DAILY') yield addDays(e.wall, i * interval)
    else if (freq === 'MONTHLY') {
      const total = e.wall.m - 1 + i * interval
      const w = { ...e.wall, y: e.wall.y + Math.floor(total / 12), m: (total % 12) + 1 }
      // 31일 같은 날짜가 없는 달은 건너뛴다(RFC 5545 규칙과 같다).
      if (new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDate() === w.d) yield w
    } else if (freq === 'YEARLY') yield { ...e.wall, y: e.wall.y + i * interval }
    else { yield e.wall; return }
  }
}

/** from~to(ms) 사이에 시작하는 일정을 시간순으로 */
export function occurrencesBetween(events: VEvent[], from: number, to: number): Occurrence[] {
  const overridden = new Set(events.filter((e) => e.recurrenceId !== null).map((e) => `${e.uid}@${e.recurrenceId}`))
  const out: Occurrence[] = []

  for (const e of events) {
    if (e.cancelled) continue
    const r = e.rrule
    // UNTIL 이 날짜만 있으면 그날 하루 전체를 포함한다.
    const u = r?.['UNTIL'] ? timeOf('UNTIL', r['UNTIL']) : null
    const until = u ? u.ms + (u.dateOnly ? 86_399_999 : 0) : Infinity
    const count = r?.['COUNT'] ? Number(r['COUNT']) : Infinity
    let n = 0
    for (const w of candidates(e)) {
      const start = wallToUtc(w, e.tz)
      if (start > until || n >= count || start > to) break
      n++
      if (e.recurrenceId === null && e.rrule && (e.exdates.has(start) || overridden.has(`${e.uid}@${start}`))) continue
      if (start >= from) out.push({ uid: e.uid, title: e.title, start, allDay: !!e.allDay })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
