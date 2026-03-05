import { useState, useEffect, useRef, useCallback } from 'react'

export type PomodoroPhase = 'work' | 'break'

export interface PomodoroConfig {
  workMinutes: number
  breakMinutes: number
}

export const DEFAULT_CONFIG: PomodoroConfig = { workMinutes: 25, breakMinutes: 5 }

export interface PomodoroState {
  phase: PomodoroPhase
  seconds: number
  running: boolean
  round: number
  config: PomodoroConfig
}

export interface PomodoroControls {
  toggle: () => void
  reset: () => void
  switchPhase: (p: PomodoroPhase) => void
  setConfig: (c: PomodoroConfig) => void
}

function phaseSeconds(cfg: PomodoroConfig, phase: PomodoroPhase): number {
  return (phase === 'work' ? cfg.workMinutes : cfg.breakMinutes) * 60
}

const STORAGE_KEY = 'mungyi-pomo-config'

function loadConfig(): PomodoroConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        workMinutes: Math.max(1, Math.min(120, parsed.workMinutes ?? 25)),
        breakMinutes: Math.max(1, Math.min(60, parsed.breakMinutes ?? 5)),
      }
    }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

export function usePomodoro(onFinish: (msg: string) => void) {
  const [config, setConfigState] = useState<PomodoroConfig>(loadConfig)
  const [phase, setPhase] = useState<PomodoroPhase>('work')
  const [seconds, setSeconds] = useState(() => loadConfig().workMinutes * 60)
  const [running, setRunning] = useState(false)
  const [round, setRound] = useState(1)
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    if (!running) return
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          setRunning(false)
          const cfg = configRef.current
          setPhase((currentPhase) => {
            const next: PomodoroPhase = currentPhase === 'work' ? 'break' : 'work'
            if (next === 'break') {
              onFinish(`🍅 ${round}번째 뽀모 완료! ${cfg.breakMinutes}분 휴식해요~`)
              window.electronAPI.showNotification('🍅 뽀모도로 완료!', `${round}번째 집중 완료! ${cfg.breakMinutes}분 휴식하세요.`)
            } else {
              setRound((r) => r + 1)
              onFinish('☀️ 휴식 끝! 다시 집중해봐요 💪')
              window.electronAPI.showNotification('☀️ 휴식 종료!', '다시 집중할 시간이에요!')
            }
            setSeconds(phaseSeconds(cfg, next))
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
    setPhase((p) => { setSeconds(phaseSeconds(configRef.current, p)); return p })
  }, [])

  const switchPhase = useCallback((p: PomodoroPhase) => {
    setRunning(false)
    setPhase(p)
    setSeconds(phaseSeconds(configRef.current, p))
  }, [])

  const setConfig = useCallback((c: PomodoroConfig) => {
    const safe = {
      workMinutes: Math.max(1, Math.min(120, c.workMinutes)),
      breakMinutes: Math.max(1, Math.min(60, c.breakMinutes)),
    }
    setConfigState(safe)
    configRef.current = safe
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
    setRunning(false)
    setPhase((p) => { setSeconds(phaseSeconds(safe, p)); return p })
  }, [])

  return {
    state: { phase, seconds, running, round, config },
    controls: { toggle, reset, switchPhase, setConfig }
  }
}
