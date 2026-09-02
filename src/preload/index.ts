import { contextBridge, ipcRenderer } from 'electron'

interface Action {
  type: string
  seconds?: number
  label?: string
  text?: string
  urgent?: boolean
}

interface AppSettings {
  breakInterval: number
  startAtLogin: boolean
  runInBackground: boolean
  petSpeed: number
  petName: string
  voiceEnabled: boolean
}

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send('set-ignore-mouse-events', ignore),

  geminiChat: (sessionId: string, message: string): Promise<{ text?: string; error?: string; actions?: Action[] }> =>
    ipcRenderer.invoke('gemini-chat', sessionId, message),

  showNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('show-notification', title, body),

  // 예약 알람 (메인 프로세스 타이머 → 창이 숨겨져도 정시에 울린다)
  scheduleAlarm: (payload: { id: string; label: string; delayMs: number; title?: string }): Promise<void> =>
    ipcRenderer.invoke('schedule-alarm', payload),
  cancelAlarm: (id: string): Promise<void> => ipcRenderer.invoke('cancel-alarm', id),
  onAlarmFired: (cb: (payload: { id: string; label: string }) => void) =>
    ipcRenderer.on('alarm-fired', (_e, payload) => cb(payload)),
  offAlarmFired: () => ipcRenderer.removeAllListeners('alarm-fired'),

  getScreenSize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke('get-screen-size'),

  getWeather: (): Promise<{ temp: number; code: number; emoji: string; desc: string } | null> =>
    ipcRenderer.invoke('fetch-weather'),

  // 시스템 통계 (CPU + RAM)
  onSystemStats: (cb: (stats: { cpu: number; ram: { used: number; totalGB: number; freeGB: number } }) => void) =>
    ipcRenderer.on('system-stats', (_e, stats) => cb(stats)),
  offSystemStats: () => ipcRenderer.removeAllListeners('system-stats'),

  // 하위 호환 (CPU only)
  onCpuUpdate: (cb: (usage: number) => void) =>
    ipcRenderer.on('system-stats', (_e, stats) => cb(stats.cpu)),
  offCpuUpdate: () => ipcRenderer.removeAllListeners('system-stats'),

  // 휴식 알림
  onBreakReminder: (cb: (minutes: number) => void) =>
    ipcRenderer.on('break-reminder', (_e, minutes) => cb(minutes)),
  offBreakReminder: () => ipcRenderer.removeAllListeners('break-reminder'),

  // Python NLP 엔진
  runPython: (payload: { task: string; input: unknown }): Promise<{ result?: unknown; error?: string }> =>
    ipcRenderer.invoke('run-python', payload),

  // 설정
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (s: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('save-settings', s),
  onSettingsUpdated: (cb: (s: AppSettings) => void) =>
    ipcRenderer.on('settings-updated', (_e, s) => cb(s)),
  offSettingsUpdated: () => ipcRenderer.removeAllListeners('settings-updated'),
})
