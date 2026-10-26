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
  geminiModel: string
  geminiApiKeySet: boolean
  petSize: number
  character?: { file: string; width: number; height: number; cols: number; rows: number; counts: number[] }
  aiReady: boolean
  clickTalk: boolean
  workHours: { enabled: boolean; start: string; lunch: string; end: string; days: number[]; startAlert: boolean; lunchAlert: boolean; leaveAlert: boolean }
  weatherPlace?: WeatherPlace
  calendars: { name: string }[]
  calendarAlertMinutes: number[]
}

interface WeatherPlace { name: string; label: string; latitude: number; longitude: number }
interface UpcomingEvent { title: string; start: number; allDay: boolean; source: string }

/** 저장할 때만 쓰는 형태. geminiApiKey를 넣으면 키가 바뀌고, 빼면 그대로 둔다. */
type SettingsPatch = AppSettings & { geminiApiKey?: string }

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

  getWeather: (): Promise<{ temp: number; code: number; emoji: string; desc: string; place: string } | null> =>
    ipcRenderer.invoke('fetch-weather'),
  searchPlace: (query: string): Promise<WeatherPlace[]> => ipcRenderer.invoke('search-place', query),

  // 캘린더
  addCalendar: (name: string, url: string): Promise<{ ok: boolean; error?: string; count?: number; settings?: AppSettings }> =>
    ipcRenderer.invoke('add-calendar', name, url),
  removeCalendar: (index: number): Promise<AppSettings> => ipcRenderer.invoke('remove-calendar', index),
  getUpcomingEvents: (days: number): Promise<UpcomingEvent[]> => ipcRenderer.invoke('get-upcoming-events', days),
  refreshCalendars: (): Promise<void> => ipcRenderer.invoke('refresh-calendars'),

  // 메인이 시키는 말 (근무 시간 인사 등)
  onPetSay: (cb: (p: { text: string; emotion: string }) => void) => ipcRenderer.on('pet-say', (_e, p) => cb(p)),
  offPetSay: () => ipcRenderer.removeAllListeners('pet-say'),

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
  saveSettings: (s: SettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('save-settings', s),
  onSettingsUpdated: (cb: (s: AppSettings) => void) =>
    ipcRenderer.on('settings-updated', (_e, s) => cb(s)),
  offSettingsUpdated: () => ipcRenderer.removeAllListeners('settings-updated'),

  // 캐릭터 시트
  importCharacter: (): Promise<{ ok: boolean; error?: string; settings?: AppSettings }> =>
    ipcRenderer.invoke('import-character'),
  removeCharacter: (): Promise<AppSettings> => ipcRenderer.invoke('remove-character'),
  getCharacterSheet: (): Promise<string | null> => ipcRenderer.invoke('get-character-sheet'),

  // 펫 우클릭 메뉴
  showPetMenu: () => ipcRenderer.send('show-pet-menu'),
  onPetMenu: (cb: (action: string) => void) => ipcRenderer.on('pet-menu', (_e, action) => cb(action)),
  offPetMenu: () => ipcRenderer.removeAllListeners('pet-menu'),
})
