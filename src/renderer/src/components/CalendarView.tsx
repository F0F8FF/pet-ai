import { useState, useEffect, useCallback } from 'react'

const DAYS_AHEAD = 14
const ALERT_CHOICES = [30, 15, 10, 5]
const SOURCE_COLORS = ['#a8d8ea', '#ffab94', '#b5e3b0', '#d7c4f2', '#ffe08a']

function dayLabel(d: Date): string {
  const today = new Date()
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return '오늘'
  if (d.toDateString() === tomorrow.toDateString()) return '내일'
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

export function CalendarView() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [events, setEvents] = useState<UpcomingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [calName, setCalName] = useState('')
  const [calUrl, setCalUrl] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadEvents = useCallback(async () => {
    setEvents(await window.electronAPI.getUpcomingEvents(DAYS_AHEAD))
    setLoading(false)
  }, [])

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
    loadEvents()
  }, [loadEvents])

  if (!settings) return null
  const calendars = settings.calendars
  const colorOf = (source: string) => SOURCE_COLORS[Math.max(0, calendars.findIndex((c) => c.name === source)) % SOURCE_COLORS.length]

  const refresh = async () => {
    setLoading(true)
    await window.electronAPI.refreshCalendars()
    await loadEvents()
  }

  const add = async () => {
    if (!calUrl.trim() || busy) return
    setBusy(true)
    setStatus(null)
    const res = await window.electronAPI.addCalendar(calName, calUrl)
    setBusy(false)
    if (!res.ok) { setStatus({ ok: false, text: res.error ?? '추가하지 못했어요' }); return }
    if (res.settings) setSettings(res.settings)
    setCalName('')
    setCalUrl('')
    setAdding(false)
    setStatus({ ok: true, text: `✅ 일정 ${res.count}개를 읽었어요` })
    loadEvents()
  }

  const remove = async (i: number) => {
    setSettings(await window.electronAPI.removeCalendar(i))
    loadEvents()
  }

  const toggleMinute = async (m: number) => {
    const cur = settings.calendarAlertMinutes
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => b - a)
    setSettings(await window.electronAPI.saveSettings({ ...settings, calendarAlertMinutes: next }))
  }

  const groups: { label: string; items: UpcomingEvent[] }[] = []
  for (const e of events) {
    const label = dayLabel(new Date(e.start))
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(e)
    else groups.push({ label, items: [e] })
  }

  return (
    <div className="cal-view">
      <div className="cal-head">
        <span>앞으로 2주 일정</span>
        {calendars.length > 0 && (
          <button className="cal-refresh" onClick={refresh} disabled={loading} title="지금 다시 읽기">
            {loading ? '…' : '↻'}
          </button>
        )}
      </div>

      <div className="cal-events">
        {calendars.length === 0 ? (
          <div className="todo-empty">아직 연결한 캘린더가 없어요.<br />아래에서 ICS 주소를 넣어 주세요 📅</div>
        ) : !loading && groups.length === 0 ? (
          <div className="todo-empty">2주 동안 일정이 없어요! 🌿</div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="cal-day">
              <div className="done-label">{g.label}</div>
              {g.items.map((e) => (
                <div key={`${e.source}:${e.start}:${e.title}`} className="cal-event">
                  <span className="cal-dot" style={{ background: colorOf(e.source) }} />
                  <span className="cal-time">
                    {e.allDay ? '종일' : new Date(e.start).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="cal-title">{e.title}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="cal-manage">
        <div className="done-label">연결한 캘린더</div>
        {calendars.map((c, i) => (
          <div key={i} className="cal-source">
            <span className="cal-dot" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
            <span className="cal-title">{c.name}</span>
            <button className="del-btn" onClick={() => remove(i)} title="빼기">×</button>
          </div>
        ))}

        {adding ? (
          <div className="cal-add">
            <div className="settings-desc">
              구글 캘린더 설정 → "iCal 형식의 비공개 주소". 읽기만 하고, 주소는 키체인으로 암호화해 이 맥에만 저장해요.
            </div>
            <div className="settings-key-row">
              <input className="settings-input cal-name" value={calName} onChange={(e) => setCalName(e.target.value)} placeholder="이름 (회사)" />
              <input
                type="password"
                className="settings-input"
                value={calUrl}
                onChange={(e) => setCalUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add() }}
                placeholder="https://… .ics"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="settings-key-row">
              <button className="opt-btn" onClick={add} disabled={!calUrl.trim() || busy}>{busy ? '읽는 중…' : '추가'}</button>
              <button className="opt-btn" onClick={() => { setAdding(false); setStatus(null) }}>취소</button>
            </div>
          </div>
        ) : (
          <button className="opt-btn cal-add-btn" onClick={() => setAdding(true)}>+ 캘린더 연결</button>
        )}
        {status && <div className={`settings-desc ${status.ok ? '' : 'settings-error'}`}>{status.text}</div>}

        <div className="done-label">일정 알림</div>
        <div className="settings-options">
          {ALERT_CHOICES.map((m) => (
            <button key={m} className={`opt-btn ${settings.calendarAlertMinutes.includes(m) ? 'active' : ''}`} onClick={() => toggleMinute(m)}>
              {m}분 전
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
