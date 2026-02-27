import { useEffect, useRef, useState } from 'react'
import { PomodoroPhase, PomodoroState, PomodoroControls, PHASES } from '../hooks/usePomodoro'

interface PomodoroProps {
  state: PomodoroState
  controls: PomodoroControls
}

export function Pomodoro({ state, controls }: PomodoroProps) {
  const { phase, seconds, running, round } = state
  const { toggle, reset, switchPhase } = controls
  const [ringSize, setRingSize] = useState(120)
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

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const progress = 1 - seconds / PHASES[phase]
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const strokeColor = phase === 'work' ? '#ff6b9d' : '#87ceeb'
  const fontSize = Math.max(14, Math.floor(ringSize * 0.18))
  const labelSize = Math.max(10, Math.floor(ringSize * 0.1))

  return (
    <div className="pomodoro">
      <div className="pomo-tabs">
        <button className={`pomo-tab ${phase === 'work' ? 'active' : ''}`} onClick={() => switchPhase('work')}>
          🍅 집중 25분
        </button>
        <button className={`pomo-tab ${phase === 'break' ? 'active' : ''}`} onClick={() => switchPhase('break')}>
          ☀️ 휴식 5분
        </button>
      </div>

      {/* 링 영역: flex:1 로 남은 공간 차지 */}
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

        {/* 링 가운데 텍스트 - SVG 위에 절대 위치 */}
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
