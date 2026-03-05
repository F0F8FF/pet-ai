import { useEffect, useRef, useState } from 'react'
import { PomodoroState, PomodoroControls } from '../hooks/usePomodoro'

interface PomodoroProps {
  state: PomodoroState
  controls: PomodoroControls
}

export function Pomodoro({ state, controls }: PomodoroProps) {
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
    </div>
  )
}
