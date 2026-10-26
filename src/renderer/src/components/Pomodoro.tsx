import { useEffect, useRef, useState } from 'react'
import { PomodoroState, PomodoroControls } from '../hooks/usePomodoro'
import { FocusLog, dayKey } from '../hooks/useFocusLog'

interface PomodoroProps {
  state: PomodoroState
  controls: PomodoroControls
  focusLog: FocusLog
}

const GRASS_WEEKS = 15

/** GitHub 잔디처럼 주(열) × 요일(행). 맨 오른쪽 열이 이번 주다. */
function FocusGrass({ log }: { log: FocusLog }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const first = new Date(today)
  first.setDate(today.getDate() - today.getDay() - (GRASS_WEEKS - 1) * 7)

  const minutes = (d: Date) => Math.round((log[dayKey(d)] ?? 0) / 60)
  const level = (m: number) => (m === 0 ? 0 : m < 25 ? 1 : m < 50 ? 2 : m < 100 ? 3 : 4)

  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay())
  let week = 0
  for (const d = new Date(weekStart); d <= today; d.setDate(d.getDate() + 1)) week += minutes(d)

  const cols = Array.from({ length: GRASS_WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, r) => {
      const d = new Date(first)
      d.setDate(first.getDate() + w * 7 + r)
      return d
    }),
  )

  return (
    <div className="focus-grass">
      <div className="focus-grass-head">
        <span>오늘 집중 <b>{minutes(today)}분</b></span>
        <span>이번 주 <b>{week}분</b></span>
      </div>
      <div className="focus-grass-grid">
        {cols.map((days, w) => (
          <div key={w} className="focus-grass-col">
            {days.map((d) => {
              const m = minutes(d)
              return (
                <div
                  key={d.getTime()}
                  className={`focus-cell lv${d > today ? 'x' : level(m)}`}
                  title={`${d.getMonth() + 1}/${d.getDate()} · ${m}분`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Pomodoro({ state, controls, focusLog }: PomodoroProps) {
  const { phase, seconds, running, round, config } = state
  const { toggle, reset, switchPhase, setConfig } = controls
  const [ringSize, setRingSize] = useState(120)
  const [editing, setEditing] = useState(false)
  const [editWork, setEditWork] = useState(config.workMinutes)
  const [editBreak, setEditBreak] = useState(config.breakMinutes)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const update = () => {
      if (!wrapRef.current) return
      const { width, height } = wrapRef.current.getBoundingClientRect()
      setRingSize(Math.floor(Math.min(width, height, 280)))
    }
    update()
    const ro = new ResizeObserver(update)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const totalPhaseSeconds = (phase === 'work' ? config.workMinutes : config.breakMinutes) * 60
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const progress = 1 - seconds / totalPhaseSeconds
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const strokeColor = phase === 'work' ? '#ff6b9d' : '#87ceeb'
  const fontSize = Math.max(14, Math.floor(ringSize * 0.18))

  const handleSaveConfig = () => {
    setConfig({ workMinutes: editWork, breakMinutes: editBreak })
    setEditing(false)
  }

  return (
    <div className="pomodoro">
      <div className="pomo-tabs">
        <button className={`pomo-tab ${phase === 'work' ? 'active' : ''}`} onClick={() => switchPhase('work')}>
          🍅 집중 {config.workMinutes}분
        </button>
        <button className={`pomo-tab ${phase === 'break' ? 'active' : ''}`} onClick={() => switchPhase('break')}>
          ☀️ 휴식 {config.breakMinutes}분
        </button>
        <button
          className={`pomo-tab pomo-config-btn ${editing ? 'active' : ''}`}
          onClick={() => { setEditing(!editing); setEditWork(config.workMinutes); setEditBreak(config.breakMinutes) }}
          title="시간 설정"
        >
          ⏱
        </button>
      </div>

      {editing && (
        <div className="pomo-config">
          <div className="pomo-config-row">
            <label>🍅 집중</label>
            <input
              type="number" min={1} max={120} value={editWork}
              onChange={(e) => setEditWork(Math.max(1, Math.min(120, Number(e.target.value))))}
            />
            <span>분</span>
          </div>
          <div className="pomo-config-row">
            <label>☀️ 휴식</label>
            <input
              type="number" min={1} max={60} value={editBreak}
              onChange={(e) => setEditBreak(Math.max(1, Math.min(60, Number(e.target.value))))}
            />
            <span>분</span>
          </div>
          <div className="pomo-config-presets">
            {[[25, 5], [50, 10], [90, 15]].map(([w, b]) => (
              <button key={w} className="pomo-preset-btn" onClick={() => { setEditWork(w); setEditBreak(b) }}>
                {w}/{b}
              </button>
            ))}
          </div>
          <button className="pomo-btn primary pomo-config-save" onClick={handleSaveConfig}>
            ✓ 적용
          </button>
        </div>
      )}

      <div className="pomo-ring-wrap" ref={wrapRef}>
        <svg
          width={ringSize}
          height={ringSize}
          viewBox="0 0 90 90"
          style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}
        >
          <circle cx="45" cy="45" r={radius} fill="none" stroke="#f0f0f0" strokeWidth="5" />
          <circle
            cx="45" cy="45" r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s' }}
          />
        </svg>

        <div className="pomo-center-text" style={{ width: ringSize, height: ringSize }}>
          <span className="pomo-time" style={{ fontSize }}>{mm}:{ss}</span>
        </div>
      </div>

      <div className="pomo-round">
        Round {round}
        {running && <span className="pomo-running-dot" />}
      </div>

      <div className="pomo-btns">
        <button className="pomo-btn primary" onClick={toggle}>
          {running ? '⏸ 일시정지' : '▶ 시작'}
        </button>
        <button className="pomo-btn" onClick={reset}>↺ 리셋</button>
      </div>

      <FocusGrass log={focusLog} />
    </div>
  )
}
