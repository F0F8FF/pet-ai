import { useState, useEffect, useRef, useCallback } from 'react'

export type PomodoroPhase = 'work' | 'break'

export const PHASES: Record<PomodoroPhase, number> = {
  work: 25 * 60,
  break: 5 * 60,
}

export interface PomodoroState {
  phase: PomodoroPhase
  seconds: number
  running: boolean
  round: number
}

export interface PomodoroControls {
  toggle: () => void
  reset: () => void
  switchPhase: (p: PomodoroPhase) => void
}

export function usePomodoro(onFinish: (msg: string) => void) {
  const [phase, setPhase] = useState<PomodoroPhase>('work')
  const [seconds, setSeconds] = useState(PHASES.work)
  const [running, setRunning] = useState(false)
  const [round, setRound] = useState(1)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!running) return
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          setRunning(false)
          setPhase((currentPhase) => {
            const next: PomodoroPhase = currentPhase === 'work' ? 'break' : 'work'
            if (next === 'break') {
              onFinish(`🍅 ${round}번째 뽀모 완료! 5분 휴식해요~`)
              window.electronAPI.showNotification('🍅 뽀모도로 완료!', `${round}번째 집중 완료! 5분 휴식하세요.`)
            } else {
              setRound((r) => r + 1)
              onFinish('☀️ 휴식 끝! 다시 집중해봐요 💪')
              window.electronAPI.showNotification('☀️ 휴식 종료!', '다시 집중할 시간이에요!')
            }
            setSeconds(PHASES[next])
            return next
          })
          return 1
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [running, round, onFinish])

  const toggle = useCallback(() => setRunning((r) => !r), [])
  const reset = useCallback(() => {
    setRunning(false)
    setPhase((p) => { setSeconds(PHASES[p]); return p })
  }, [])
  const switchPhase = useCallback((p: PomodoroPhase) => {
    setRunning(false)
    setPhase(p)
    setSeconds(PHASES[p])
  }, [])

  return {
    state: { phase, seconds, running, round },
    controls: { toggle, reset, switchPhase }
  }
}
