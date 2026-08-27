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

const ALARM_ID = 'pomodoro'
const STORAGE_KEY = 'mungyi-pomo-config'

function clampConfig(c: Partial<PomodoroConfig>): PomodoroConfig {
  return {
    workMinutes: Math.max(1, Math.min(120, c.workMinutes ?? DEFAULT_CONFIG.workMinutes)),
    breakMinutes: Math.max(1, Math.min(60, c.breakMinutes ?? DEFAULT_CONFIG.breakMinutes)),
  }
}

function phaseSeconds(cfg: PomodoroConfig, phase: PomodoroPhase): number {
  return (phase === 'work' ? cfg.workMinutes : cfg.breakMinutes) * 60
}

function loadConfig(): PomodoroConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return clampConfig(JSON.parse(raw))
  } catch {}
  return { ...DEFAULT_CONFIG }
}

/**
 * 남은 시간을 1씩 깎는 대신 목표 시각(deadline)을 저장하고 매 tick마다 차이를 계산한다.
 * Chromium은 숨겨진 창의 타이머를 최대 1분에 1회로 스로틀링하므로 카운트다운 방식은
 * 트레이로 숨기는 순간 시간이 어긋난다. deadline 방식은 tick이 늦게 와도 스스로 보정된다.
 * 알림 자체는 스로틀링이 없는 메인 프로세스 타이머에 예약한다.
 */
export function usePomodoro(onFinish: (msg: string) => void) {
  const [config, setConfigState] = useState<PomodoroConfig>(loadConfig)
  const [phase, setPhase] = useState<PomodoroPhase>('work')
  const [seconds, setSeconds] = useState(() => loadConfig().workMinutes * 60)
  const [running, setRunning] = useState(false)
  const [round, setRound] = useState(1)

  const deadlineRef = useRef<number | null>(null)
  const secondsRef = useRef(seconds)
  secondsRef.current = seconds
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const configRef = useRef(config)
  configRef.current = config
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  /** 타이머를 멈추고 지정한 phase를 처음부터 시작할 수 있는 상태로 되돌린다. */
  const resetTo = useCallback((nextPhase: PomodoroPhase, cfg: PomodoroConfig) => {
    deadlineRef.current = null
    setRunning(false)
    setPhase(nextPhase)
    setSeconds(phaseSeconds(cfg, nextPhase))
    window.electronAPI.cancelAlarm(ALARM_ID)
  }, [])

  useEffect(() => {
    if (!running) return

    // 이번 구간의 목표 시각을 한 번만 정하고, 같은 시점에 메인 프로세스 알림도 예약한다.
    if (deadlineRef.current === null) {
      const total = secondsRef.current
      const cfg = configRef.current
      deadlineRef.current = Date.now() + total * 1000
      window.electronAPI.scheduleAlarm({
        id: ALARM_ID,
        title: phase === 'work' ? '🍅 뽀모도로 완료!' : '☀️ 휴식 종료!',
        label: phase === 'work'
          ? `${round}번째 집중 완료! ${cfg.breakMinutes}분 휴식하세요.`
          : '휴식 종료! 다시 집중할 시간이에요.',
        delayMs: total * 1000,
      })
    }

    const tick = () => {
      const deadline = deadlineRef.current
      if (deadline === null) return

      const remaining = Math.ceil((deadline - Date.now()) / 1000)
      if (remaining > 0) {
        setSeconds(remaining)
        return
      }

      // 구간 종료 — 알림은 메인에서 이미 발송됐으므로 상태만 다음 구간으로 넘긴다.
      const cfg = configRef.current
      const next: PomodoroPhase = phase === 'work' ? 'break' : 'work'
      if (next === 'break') {
        onFinishRef.current(`🍅 ${round}번째 뽀모 완료! ${cfg.breakMinutes}분 휴식해요~`)
      } else {
        setRound((r) => r + 1)
        onFinishRef.current('☀️ 휴식 끝! 다시 집중해봐요 💪')
      }
      resetTo(next, cfg)
    }

    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [running, phase, round, resetTo])

  const toggle = useCallback(() => {
    setRunning((wasRunning) => {
      if (!wasRunning) return true
      // 일시정지: 남은 시간을 확정해두고 예약 알람을 취소한다.
      const deadline = deadlineRef.current
      if (deadline !== null) setSeconds(Math.max(1, Math.ceil((deadline - Date.now()) / 1000)))
      deadlineRef.current = null
      window.electronAPI.cancelAlarm(ALARM_ID)
      return false
    })
  }, [])

  const reset = useCallback(() => {
    resetTo(phaseRef.current, configRef.current)
  }, [resetTo])

  const switchPhase = useCallback((p: PomodoroPhase) => {
    resetTo(p, configRef.current)
  }, [resetTo])

  const setConfig = useCallback((c: PomodoroConfig) => {
    const safe = clampConfig(c)
    setConfigState(safe)
    configRef.current = safe
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(safe)) } catch {}
    resetTo(phaseRef.current, safe)
  }, [resetTo])

  // 창이 다시 보이면 스로틀링 구간 동안 밀린 표시를 즉시 보정한다.
  useEffect(() => {
    const sync = () => {
      const deadline = deadlineRef.current
      if (document.visibilityState !== 'visible' || deadline === null) return
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => () => { window.electronAPI.cancelAlarm(ALARM_ID) }, [])

  return {
    state: { phase, seconds, running, round, config },
    controls: { toggle, reset, switchPhase, setConfig }
  }
}
