import { useEffect, useRef, useState } from 'react'
import { PomodoroState } from './usePomodoro'

const STORAGE_KEY = 'mungyi-focus-log'
// 숨긴 창은 tick 이 1분에 한 번까지 늦어진다. 그보다 큰 차이는 리셋·구간 전환으로 본다.
const MAX_TICK_GAP_S = 90

export type FocusLog = Record<string, number> // 'YYYY-MM-DD' → 집중한 초

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function load(): FocusLog {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}

/** 뽀모도로 집중 구간에서 실제로 흐른 시간만 날짜별로 쌓는다. 쉬는 시간과 일시정지는 빠진다. */
export function useFocusLog(state: PomodoroState): FocusLog {
  const [log, setLog] = useState<FocusLog>(load)
  const prev = useRef<number | null>(null)

  useEffect(() => {
    if (!state.running || state.phase !== 'work') { prev.current = null; return }
    const before = prev.current
    prev.current = state.seconds
    if (before === null) return
    const delta = before - state.seconds
    if (delta <= 0 || delta > MAX_TICK_GAP_S) return
    setLog((l) => {
      const k = dayKey()
      const next = { ...l, [k]: (l[k] ?? 0) + delta }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [state.running, state.phase, state.seconds])

  return log
}
