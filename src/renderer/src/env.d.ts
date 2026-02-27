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
}

interface SystemStats {
  cpu: number
  ram: { used: number; totalGB: number; freeGB: number }
}

interface WindowElectron {
  electronAPI: {
    setIgnoreMouseEvents: (ignore: boolean) => void
    geminiChat: (sessionId: string, message: string) => Promise<{ text?: string; error?: string; actions?: Action[] }>
    showNotification: (title: string, body: string) => Promise<void>
    getScreenSize: () => Promise<{ width: number; height: number }>
    getWeather: () => Promise<{ temp: number; code: number; emoji: string; desc: string } | null>
    getSpriteBase64: () => Promise<string | null>
    onSystemStats: (cb: (stats: SystemStats) => void) => void
    offSystemStats: () => void
    onCpuUpdate: (cb: (usage: number) => void) => void
    offCpuUpdate: () => void
    onBreakReminder: (cb: (minutes: number) => void) => void
    offBreakReminder: () => void
    getSettings: () => Promise<AppSettings>
    saveSettings: (s: AppSettings) => Promise<AppSettings>
    onSettingsUpdated: (cb: (s: AppSettings) => void) => void
    offSettingsUpdated: () => void
  }
}

interface Window extends WindowElectron {}
