/// <reference types="vite/client" />

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionResult {
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}
interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}
interface SpeechRecognition extends EventTarget {
  start(): void
  stop(): void
  abort(): void
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}
interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

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
  petSpeed: number
  petName: string
  voiceEnabled: boolean
  runInBackground: boolean
  geminiModel: string
  /** 키가 저장돼 있는지 여부. 키 원문은 메인 프로세스 밖으로 나오지 않는다. */
  geminiApiKeySet: boolean
  /** 펫 크기 배율 (1 = 보통) */
  petSize: number
  /** 사용자가 넣은 ChatGPT Pets 시트 정보. 없으면 기본 강아지 */
  character?: CharacterMeta
  /** 채팅에 쓸 AI(키 또는 Ollama)가 준비됐는지 */
  aiReady: boolean
  /** true 면 한 번 클릭이 말 걸기, 두 번 클릭이 패널 */
  clickTalk: boolean
  workHours: WorkHours
  /** 날씨 지역. 없으면 날씨를 묻지 않는다 */
  weatherPlace?: WeatherPlace
  /** 연결한 캘린더 이름 (주소는 메인에만 있다) */
  calendars: { name: string }[]
  /** 일정 몇 분 전에 알릴지 */
  calendarAlertMinutes: number[]
}

interface WorkHours {
  enabled: boolean
  start: string
  lunch: string
  end: string
  /** 0 일요일 ~ 6 토요일 */
  days: number[]
  startAlert: boolean
  lunchAlert: boolean
  leaveAlert: boolean
}

interface WeatherPlace { name: string; label: string; latitude: number; longitude: number }
interface UpcomingEvent { title: string; start: number; allDay: boolean; source: string }

interface CharacterMeta {
  file: string
  width: number
  height: number
  cols: number
  rows: number
  /** 줄마다 그림이 들어 있는 칸 수 */
  counts: number[]
}

/** 저장할 때만 쓰는 형태. geminiApiKey를 넣으면 키가 바뀌고, 빼면 그대로 둔다. */
type SettingsPatch = AppSettings & { geminiApiKey?: string }

interface SystemStats {
  cpu: number
  ram: { used: number; totalGB: number; freeGB: number }
}

interface WindowElectron {
  electronAPI: {
    setIgnoreMouseEvents: (ignore: boolean) => void
    geminiChat: (sessionId: string, message: string) => Promise<{ text?: string; error?: string; actions?: Action[] }>
    showNotification: (title: string, body: string) => Promise<void>
    scheduleAlarm: (payload: { id: string; label: string; delayMs: number; title?: string }) => Promise<void>
    cancelAlarm: (id: string) => Promise<void>
    onAlarmFired: (cb: (payload: { id: string; label: string }) => void) => void
    offAlarmFired: () => void
    getScreenSize: () => Promise<{ width: number; height: number }>
    getWeather: () => Promise<{ temp: number; code: number; emoji: string; desc: string; place: string } | null>
    searchPlace: (query: string) => Promise<WeatherPlace[]>
    addCalendar: (name: string, url: string) => Promise<{ ok: boolean; error?: string; count?: number; settings?: AppSettings }>
    removeCalendar: (index: number) => Promise<AppSettings>
    getUpcomingEvents: (days: number) => Promise<UpcomingEvent[]>
    refreshCalendars: () => Promise<void>
    onPetSay: (cb: (p: { text: string; emotion: string }) => void) => void
    offPetSay: () => void
    onSystemStats: (cb: (stats: SystemStats) => void) => void
    offSystemStats: () => void
    onCpuUpdate: (cb: (usage: number) => void) => void
    offCpuUpdate: () => void
    onBreakReminder: (cb: (minutes: number) => void) => void
    offBreakReminder: () => void
    runPython: (payload: { task: string; input: unknown }) => Promise<{ result?: unknown; error?: string }>
    getSettings: () => Promise<AppSettings>
    saveSettings: (s: SettingsPatch) => Promise<AppSettings>
    onSettingsUpdated: (cb: (s: AppSettings) => void) => void
    offSettingsUpdated: () => void
    importCharacter: () => Promise<{ ok: boolean; error?: string; settings?: AppSettings }>
    removeCharacter: () => Promise<AppSettings>
    getCharacterSheet: () => Promise<string | null>
    showPetMenu: () => void
    onPetMenu: (cb: (action: string) => void) => void
    offPetMenu: () => void
  }
}

interface Window extends WindowElectron {}
