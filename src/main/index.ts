import { app, shell, BrowserWindow, ipcMain, screen, Notification, Tray, Menu, nativeImage, safeStorage, dialog } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { analyzeSheet, CharacterMeta } from './character'
import { parseIcs, occurrencesBetween, Occurrence } from './ics'
import { config } from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { spawn, ChildProcess } from 'child_process'
import os from 'os'

config()

// ── 단일 인스턴스 (Electron lock이 보장, 락 파일은 참고용) ────────
const LOCK_PATH = join(app.getPath('userData'), '.single-instance.lock')

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 실행 중인 PID를 락 파일에 기록한다. 단일 인스턴스 보장은 Electron의
 * requestSingleInstanceLock()이 담당하므로 이 파일은 참고용이며, 기록에 실패해도
 * 실행을 막지 않는다. (userData 폴더는 ready 이전에는 존재하지 않을 수 있고,
 * 강제 종료로 남은 PID가 재사용되면 앱이 영구히 실행 불가가 되기 때문)
 */
function writeLockFile(): void {
  try {
    mkdirSync(dirname(LOCK_PATH), { recursive: true })
    if (existsSync(LOCK_PATH)) {
      const pid = parseInt(readFileSync(LOCK_PATH, 'utf-8').trim(), 10)
      if (!isNaN(pid) && pid !== process.pid && isPidRunning(pid)) {
        console.warn('[단일 인스턴스] 다른 PID의 락이 남아 있습니다:', pid)
      }
    }
    writeFileSync(LOCK_PATH, String(process.pid))
  } catch (e) {
    console.warn('[단일 인스턴스] 락 파일 기록 실패(무시하고 계속):', e)
  }
}

function releaseLock() {
  try {
    if (existsSync(LOCK_PATH) && readFileSync(LOCK_PATH, 'utf-8').trim() === String(process.pid)) {
      unlinkSync(LOCK_PATH)
    }
  } catch {}
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
writeLockFile()

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('will-quit', releaseLock)

// ── 설정 파일 ──────────────────────────────────────────────
const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

/**
 * 렌더러와 주고받는 설정. API 키 원문은 여기에 절대 담지 않는다.
 * 저장돼 있는지 여부(geminiApiKeySet)만 알려주고, 값은 메인에만 둔다.
 */
interface AppSettings {
  breakInterval: number
  startAtLogin: boolean
  petSpeed: number
  petName: string         // 펫 이름 (기본 뭉이)
  voiceEnabled: boolean   // TTS 켜기
  runInBackground: boolean // 창 닫아도 트레이에서 계속 실행
  geminiModel: string     // 쓸 Gemini 모델 이름
  geminiApiKeySet: boolean // 키가 저장돼 있는지 (원문은 보내지 않음)
  petSize: number         // 펫 크기 배율 (1 = 보통)
  character?: CharacterMeta // 사용자가 넣은 캐릭터 시트. 없으면 기본 강아지
  aiReady: boolean        // 채팅에 쓸 AI가 준비됐는지 (키 또는 Ollama)
  clickTalk: boolean      // true 면 한 번 클릭이 말 걸기, 두 번 클릭이 패널
  workHours: WorkHours
  weatherPlace?: WeatherPlace // 없으면 날씨를 묻지 않는다
  calendars: { name: string }[] // 주소는 비밀번호나 마찬가지라 이름만 보낸다
  calendarAlertMinutes: number[]
}

interface WorkHours {
  enabled: boolean
  start: string // "HH:MM"
  lunch: string
  end: string
  days: number[] // 0 일요일 ~ 6 토요일
  startAlert: boolean
  lunchAlert: boolean
  leaveAlert: boolean
}

interface WeatherPlace { name: string; label: string; latitude: number; longitude: number }

/** 디스크(settings.json)에 저장되는 형태. 키와 캘린더 주소는 암호화해서 보관한다. */
type StoredSettings = Omit<AppSettings, 'geminiApiKeySet' | 'aiReady' | 'calendars'> & {
  geminiApiKey?: string
  calendars: { name: string; url: string }[]
}

/** 렌더러가 save-settings로 보내는 형태. geminiApiKey가 있을 때만 키를 바꾼다. */
type SettingsPatch = AppSettings & { geminiApiKey?: string }

const DEFAULT_WORK_HOURS: WorkHours = {
  enabled: true, start: '09:00', lunch: '12:00', end: '18:00', days: [1, 2, 3, 4, 5],
  startAlert: true, lunchAlert: true, leaveAlert: true,
}

const DEFAULT_SETTINGS: StoredSettings = {
  breakInterval: 90, startAtLogin: false, petSpeed: 1, petName: '뭉이', voiceEnabled: false,
  runInBackground: true, geminiModel: 'gemini-2.5-flash', petSize: 1, clickTalk: false,
  workHours: DEFAULT_WORK_HOURS, calendars: [], calendarAlertMinutes: [10],
}

function loadSettings(): StoredSettings {
  try {
    if (existsSync(SETTINGS_PATH)) return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

// ── API 키 보관 ──────────────────────────────────────────────
// 평문으로 두면 settings.json을 열어보는 누구나 키를 쓸 수 있다. macOS는
// safeStorage가 키체인을 쓰므로 암호화해서 넣고, 암호화를 못 쓰는 환경에서는
// 기능이 아예 죽지 않도록 표시를 남기고 인코딩만 해서 보관한다.
const KEY_ENC = 'enc:'
const KEY_PLAIN = 'plain:'

function protectApiKey(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return KEY_ENC + safeStorage.encryptString(plain).toString('base64')
    }
    console.warn('[설정] 이 환경에서는 암호화를 쓸 수 없어 API 키를 인코딩만 해서 보관합니다.')
  } catch (e) {
    console.warn('[설정] API 키 암호화 실패:', e)
  }
  return KEY_PLAIN + Buffer.from(plain, 'utf-8').toString('base64')
}

function revealApiKey(saved: string | undefined): string {
  if (!saved) return ''
  try {
    if (saved.startsWith(KEY_ENC)) {
      return safeStorage.decryptString(Buffer.from(saved.slice(KEY_ENC.length), 'base64'))
    }
    if (saved.startsWith(KEY_PLAIN)) {
      return Buffer.from(saved.slice(KEY_PLAIN.length), 'base64').toString('utf-8')
    }
  } catch (e) {
    // 다른 기기에서 복사해 온 settings.json은 복호화할 수 없다. 이때는 키가
    // 없는 것으로 보고 사용자가 다시 입력하게 한다.
    console.warn('[설정] 저장된 API 키를 읽을 수 없습니다. 다시 입력이 필요합니다:', e)
  }
  return ''
}

/** 렌더러로 내보낼 설정. 키 원문을 빼고 저장 여부만 남긴다. */
function toPublicSettings(s: StoredSettings): AppSettings {
  const { geminiApiKey, calendars, ...rest } = s
  const ollama = (process.env['LLM_PROVIDER'] || '').toLowerCase() === 'ollama'
  return {
    ...rest,
    calendars: (calendars ?? []).map((c) => ({ name: c.name })),
    geminiApiKeySet: !!geminiApiKey,
    aiReady: ollama || !!geminiApiKey || !!process.env['GEMINI_API_KEY'],
  }
}

// ── 캐릭터 시트 ──────────────────────────────────────────────
// 그림은 앱에 넣지 않고 사용자가 고른 파일을 userData에 복사해 둔다.
const CHARACTER_DIR = join(app.getPath('userData'), 'character')

async function importCharacter(): Promise<{ ok: boolean; error?: string; settings?: AppSettings }> {
  // 화면 전체를 덮는 최상단 창 아래로 대화상자가 깔리지 않게 잠깐 내려 둔다.
  mainWindow?.setAlwaysOnTop(false)
  const picked = await dialog.showOpenDialog({
    title: '캐릭터 시트 고르기',
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
    properties: ['openFile'],
  }).finally(() => mainWindow?.setAlwaysOnTop(true, 'screen-saver'))
  const src = picked.filePaths[0]
  if (picked.canceled || !src) return { ok: false }

  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) return { ok: false, error: '이미지를 열 수 없어요' }
  const { width, height } = img.getSize()
  const meta = analyzeSheet(img.toBitmap(), width, height)
  if (typeof meta === 'string') return { ok: false, error: meta }

  // 파일 이름을 매번 바꿔야 렌더러가 예전 그림을 캐시에서 꺼내 쓰지 않는다.
  const file = `sheet-${Date.now()}.png`
  rmSync(CHARACTER_DIR, { recursive: true, force: true })
  mkdirSync(CHARACTER_DIR, { recursive: true })
  copyFileSync(src, join(CHARACTER_DIR, file))
  settings.character = { ...meta, file }
  saveSettings(settings)
  const view = toPublicSettings(settings)
  mainWindow?.webContents.send('settings-updated', view)
  return { ok: true, settings: view }
}

function removeCharacter(): AppSettings {
  rmSync(CHARACTER_DIR, { recursive: true, force: true })
  settings.character = undefined
  saveSettings(settings)
  const view = toPublicSettings(settings)
  mainWindow?.webContents.send('settings-updated', view)
  return view
}

/** 개발 서버(http)에서는 file:// 그림을 못 읽으므로 data URL로 넘긴다. */
function readCharacterSheet(): string | null {
  const file = settings.character?.file
  if (!file) return null
  try {
    return 'data:image/png;base64,' + readFileSync(join(CHARACTER_DIR, file)).toString('base64')
  } catch {
    return null
  }
}

/** 펫 우클릭 메뉴. 고른 항목은 렌더러가 처리한다. */
function showPetMenu() {
  const send = (action: string) => () => mainWindow?.webContents.send('pet-menu', action)
  Menu.buildFromTemplate([
    { label: '💬 말 걸기', click: send('talk') },
    { label: '채팅 열기', click: send('chat') },
    { label: '할 일', click: send('todo') },
    { label: '뽀모도로', click: send('pomo') },
    { label: '캘린더', click: send('cal') },
    { label: '설정', click: send('settings') },
    { type: 'separator' },
    { label: '잠깐 숨기기', click: () => mainWindow?.hide() },
    { label: '종료', click: () => { isAppQuitting = true; app.quit() } },
  ]).popup({ window: mainWindow ?? undefined })
}

let loginItemUnavailable = false

/** 로그인 시 자동 시작 설정 적용. 실패 시(예: macOS 권한) 설정을 OS 실제 값에 맞춰 동기화하고 false 반환. */
function applyLoginItemSetting(openAtLogin: boolean): boolean {
  if (loginItemUnavailable) {
    const actual = app.getLoginItemSettings()
    settings.startAtLogin = actual.openAtLogin
    saveSettings(settings)
    return false
  }
  try {
    app.setLoginItemSettings({ openAtLogin, openAsHidden: true })
  } catch (_e) {}
  const actual = app.getLoginItemSettings()
  if (actual.openAtLogin !== openAtLogin) {
    loginItemUnavailable = true
    settings.startAtLogin = actual.openAtLogin
    saveSettings(settings)
    return false
  }
  return true
}

function saveSettings(s: StoredSettings) {
  try { writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)) } catch {}
}

function weatherFromCode(code: number, temp: number): { emoji: string; desc: string } {
  if (code === 0) return temp > 28 ? { emoji: '☀️', desc: '맑고 더워요' } : { emoji: '☀️', desc: '맑아요' }
  if (code <= 3) return { emoji: '⛅', desc: '구름 조금' }
  if (code <= 48) return { emoji: '🌫️', desc: '안개 껴요' }
  if (code <= 57) return { emoji: '🌦️', desc: '이슬비 와요' }
  if (code <= 67) return { emoji: '🌧️', desc: '비 와요' }
  if (code <= 77) return { emoji: '❄️', desc: '눈 와요' }
  if (code <= 82) return { emoji: '🌧️', desc: '소나기 와요' }
  return { emoji: '⛈️', desc: '천둥번개예요' }
}

function getSystemPrompt(petName: string): string {
  return `너는 사용자의 데스크탑에 사는 귀여운 AI 펫이야. 이름은 "${petName}"이야.
성격: 항상 밝고 애교, 짧고 귀엽게, "주인님" 호칭, 한국어로만 답변.

반드시 아래 JSON 형식으로만 응답해:
{
  "text": "귀여운 답변 (2~3문장)",
  "actions": []
}

가능한 actions:
- {"type": "timer", "seconds": 60, "label": "1분 알람"}
- {"type": "add_todo", "text": "할일내용", "urgent": false}`
}

const chatHistories = new Map<string, Array<{ role: string; parts: Array<{ text: string }> }>>()
const ollamaChatHistories = new Map<string, Array<{ role: string; content: string }>>()

/**
 * 히스토리로 보관할 최대 메시지 수(= 10턴). 제한이 없으면 메모리가 계속 늘고,
 * 매 요청마다 전체 히스토리를 재전송하는 구조라 토큰 사용량이 대화 길이에 따라
 * 급격히 늘어난다(요청 한도 초과의 주 원인).
 */
const MAX_HISTORY_MESSAGES = 20

function trimHistory<T>(messages: T[]): T[] {
  return messages.length > MAX_HISTORY_MESSAGES ? messages.slice(-MAX_HISTORY_MESSAGES) : messages
}

// ── 전역 변수 ──────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let cpuTimer: ReturnType<typeof setTimeout> | null = null
let breakTimer: ReturnType<typeof setTimeout> | null = null
let settings = loadSettings()
let isAppQuitting = false

// ── CPU/RAM 샘플링 ─────────────────────────────────────────
function sampleCpuUsage(): Promise<number> {
  return new Promise((resolve) => {
    const cpus1 = os.cpus()
    setTimeout(() => {
      const cpus2 = os.cpus()
      let idle = 0, total = 0
      cpus1.forEach((cpu, i) => {
        const c2 = cpus2[i]
        idle += c2.times.idle - cpu.times.idle
        total += Object.values(c2.times).reduce((a, b) => a + b, 0) - Object.values(cpu.times).reduce((a, b) => a + b, 0)
      })
      resolve(Math.round(100 - (idle / total) * 100))
    }, 500)
  })
}

function getRamUsage() {
  const total = os.totalmem()
  const free = os.freemem()
  return {
    used: Math.round((1 - free / total) * 100),
    totalGB: Math.round(total / 1024 / 1024 / 1024 * 10) / 10,
    freeGB: Math.round(free / 1024 / 1024 / 1024 * 10) / 10,
  }
}

function startSystemMonitor() {
  const poll = async () => {
    const cpu = await sampleCpuUsage()
    const ram = getRamUsage()
    mainWindow?.webContents.send('system-stats', { cpu, ram })
    cpuTimer = setTimeout(poll, 3000)
  }
  poll()
}

// ── 예약 알람 ──────────────────────────────────────────────
// 렌더러의 setTimeout은 창이 숨겨지면 Chromium이 최대 1분에 1회로 스로틀링한다.
// 시간에 민감한 알람은 스로틀링이 없는 메인 프로세스 타이머로 처리한다.

const alarmTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelAlarm(id: string) {
  const timer = alarmTimers.get(id)
  if (timer) { clearTimeout(timer); alarmTimers.delete(id) }
}

function clearAllAlarms() {
  for (const timer of alarmTimers.values()) clearTimeout(timer)
  alarmTimers.clear()
}

function scheduleAlarm(id: string, label: string, delayMs: number, title?: string) {
  cancelAlarm(id)
  const timer = setTimeout(() => {
    alarmTimers.delete(id)
    new Notification({ title: title || `⏰ ${settings.petName || '뭉이'} 알람!`, body: label }).show()
    mainWindow?.webContents.send('alarm-fired', { id, label })
  }, Math.max(0, delayMs))
  alarmTimers.set(id, timer)
}

// ── 휴식 알림 ──────────────────────────────────────────────
function startBreakTimer(intervalMin: number) {
  if (breakTimer) clearTimeout(breakTimer)
  if (intervalMin <= 0) return
  breakTimer = setTimeout(() => {
    new Notification({ title: '💆 뭉이 휴식 알림', body: `${intervalMin}분 일했어요! 잠깐 쉬어요 주인님~` }).show()
    mainWindow?.webContents.send('break-reminder', intervalMin)
    startBreakTimer(intervalMin)
  }, intervalMin * 60 * 1000)
}

// ── 날씨 ──────────────────────────────────────────────────
// 사용자가 고른 지역의 위도·경도만 Open-Meteo에 보낸다. IP로 위치를 추측하지 않는다.
async function currentWeather(p: WeatherPlace) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,weather_code`
  )
  const wx = await res.json() as { current: { temperature_2m: number; weather_code: number } }
  const temp = Math.round(wx.current.temperature_2m)
  const code = wx.current.weather_code
  return { temp, code, ...weatherFromCode(code, temp), place: p.name }
}

async function searchPlace(query: string): Promise<WeatherPlace[]> {
  const q = query.trim()
  if (!q) return []
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=ko&format=json`
  )
  const j = await res.json() as { results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }> }
  return (j.results ?? []).map((r) => ({
    name: r.name,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(' · '),
    latitude: r.latitude,
    longitude: r.longitude,
  }))
}

// ── 근무 시간 인사 ──────────────────────────────────────────
// 하루에 한 번씩만 한다. 앱을 다시 켜도 또 하지 않도록 오늘 한 인사를 파일에 남긴다.
const GREET_PATH = join(app.getPath('userData'), 'greetings.json')

function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function petSay(text: string, emotion = 'happy') {
  mainWindow?.webContents.send('pet-say', { text, emotion })
}

async function checkWorkHours() {
  const w = { ...DEFAULT_WORK_HOURS, ...settings.workHours }
  const now = new Date()
  if (!w.enabled || !w.days.includes(now.getDay())) return
  const nowMin = now.getHours() * 60 + now.getMinutes()

  let state: { day: string; done: string[] } = { day: '', done: [] }
  try { state = JSON.parse(readFileSync(GREET_PATH, 'utf-8')) } catch {}
  if (state.day !== localDay(now)) state = { day: localDay(now), done: [] }

  const start = minutesOf(w.start), lunch = minutesOf(w.lunch), end = minutesOf(w.end)
  // 늦게 켜도 인사할 수 있게 창을 넉넉히 둔다. 단, 지난 인사를 몰아서 하지는 않는다.
  const due =
    w.leaveAlert && nowMin >= end - 10 && nowMin < end ? 'leave'
    : w.lunchAlert && nowMin >= lunch && nowMin < lunch + 60 ? 'lunch'
    : w.startAlert && nowMin >= start && nowMin < start + 120 ? 'start'
    : null
  if (!due || state.done.includes(due)) return
  state.done.push(due)
  try { writeFileSync(GREET_PATH, JSON.stringify(state)) } catch {}

  if (due === 'start') {
    let line = '좋은 아침이에요 주인님! 오늘도 같이 힘내요 ☀️'
    if (settings.weatherPlace) {
      try {
        const wx = await currentWeather(settings.weatherPlace)
        line += `\n${wx.place}는 지금 ${wx.emoji} ${wx.desc}, ${wx.temp}°C예요.`
      } catch {}
    }
    petSay(line, 'excited')
  } else if (due === 'lunch') {
    petSay('점심시간이에요! 맛있는 거 먹고 와요 🍚', 'love')
  } else {
    petSay('곧 퇴근이에요! 오늘도 고생 많았어요 👋', 'happy')
  }
}

// ── 캘린더 ────────────────────────────────────────────────
// 비공개 ICS 주소를 10분마다 읽어 다가오는 일정 몇 분 전에 알린다. 읽기만 한다.
let calendarEvents: Array<{ source: string; events: ReturnType<typeof parseIcs> }> = []
const calendarAlarmIds = new Set<string>()
const CALENDAR_REFRESH_MS = 10 * 60 * 1000
const CALENDAR_LOOKAHEAD_MS = 36 * 60 * 60 * 1000

async function fetchIcs(url: string) {
  const res = await fetch(url.replace(/^webcal:/i, 'https:'))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('ICS 형식이 아니에요')
  return parseIcs(text)
}

async function refreshCalendars() {
  const results = await Promise.all((settings.calendars ?? []).map(async (c) => {
    try {
      return { source: c.name, events: await fetchIcs(revealApiKey(c.url)) }
    } catch (e) {
      console.warn(`[캘린더] ${c.name} 읽기 실패:`, (e as Error).message)
      return null
    }
  }))
  calendarEvents = results.filter((r): r is NonNullable<typeof r> => r !== null)
  scheduleCalendarAlerts()
}

function upcomingEvents(from: number, to: number): Array<Occurrence & { source: string }> {
  return calendarEvents
    .flatMap(({ source, events }) => occurrencesBetween(events, from, to).map((o) => ({ ...o, source })))
    .sort((a, b) => a.start - b.start)
}

function scheduleCalendarAlerts() {
  for (const id of calendarAlarmIds) cancelAlarm(id)
  calendarAlarmIds.clear()
  const now = Date.now()
  for (const o of upcomingEvents(now, now + CALENDAR_LOOKAHEAD_MS)) {
    if (o.allDay) continue
    for (const m of settings.calendarAlertMinutes ?? []) {
      const at = o.start - m * 60_000
      if (at <= now) continue
      const id = `cal:${o.uid}:${o.start}:${m}`
      scheduleAlarm(id, `${m}분 뒤에 「${o.title}」 일정이 있어요!`, at - now, `📅 ${o.title}`)
      calendarAlarmIds.add(id)
    }
  }
}

async function addCalendar(name: string, url: string): Promise<{ ok: boolean; error?: string; count?: number; settings?: AppSettings }> {
  const u = url.trim()
  if (!/^(https|webcal):\/\//i.test(u)) return { ok: false, error: 'https:// 나 webcal:// 로 시작하는 ICS 주소를 넣어 주세요' }
  let events
  try {
    events = await fetchIcs(u)
  } catch (e) {
    return { ok: false, error: `캘린더를 읽지 못했어요 (${(e as Error).message})` }
  }
  settings.calendars = [...(settings.calendars ?? []), { name: name.trim() || '캘린더', url: protectApiKey(u) }]
  saveSettings(settings)
  calendarEvents.push({ source: name.trim() || '캘린더', events })
  scheduleCalendarAlerts()
  const view = toPublicSettings(settings)
  mainWindow?.webContents.send('settings-updated', view)
  return { ok: true, count: events.length, settings: view }
}

async function removeCalendar(index: number): Promise<AppSettings> {
  settings.calendars = (settings.calendars ?? []).filter((_, i) => i !== index)
  saveSettings(settings)
  await refreshCalendars()
  const view = toPublicSettings(settings)
  mainWindow?.webContents.send('settings-updated', view)
  return view
}

// ── 트레이 ──────────────────────────────────────────────────

/** 패키징 여부에 따라 리소스 파일의 실제 경로를 돌려준다. */
function resourcePath(...segments: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, ...segments)
    : join(app.getAppPath(), 'build', ...segments)
}

function createTray() {
  // nativeImage는 파일이 없어도 예외 없이 빈 이미지를 주므로 isEmpty로 확인해야 한다.
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  if (icon.isEmpty()) {
    console.warn('[트레이] 아이콘을 찾지 못했습니다:', resourcePath('tray.png'))
  }
  tray = new Tray(icon)

  tray.setToolTip(settings.petName || '뭉이')
  updateTrayMenu()

  tray.on('click', () => {
    if (mainWindow?.isVisible()) { mainWindow.hide() } else { mainWindow?.show(); mainWindow?.focus() }
  })
}

function updateTrayMenu() {
  if (!tray) return
  tray.setToolTip(settings.petName || '뭉이')
  const menu = Menu.buildFromTemplate([
    { label: mainWindow?.isVisible() ? '뭉이 숨기기' : '뭉이 보이기', click: () => { if (mainWindow?.isVisible()) mainWindow.hide(); else { mainWindow?.show(); mainWindow?.focus() } } },
    { type: 'separator' },
    { label: '휴식 알림 끄기', type: 'checkbox', checked: settings.breakInterval === 0, click: (item) => { settings.breakInterval = item.checked ? 0 : 90; saveSettings(settings); startBreakTimer(settings.breakInterval); mainWindow?.webContents.send('settings-updated', toPublicSettings(settings)) } },
    { label: '로그인 시 자동 시작', type: 'checkbox', checked: settings.startAtLogin, click: (item) => { settings.startAtLogin = item.checked; saveSettings(settings); if (!applyLoginItemSetting(item.checked)) { mainWindow?.webContents.send('settings-updated', toPublicSettings(settings)); updateTrayMenu() } } },
    { label: '백그라운드 실행 (창 닫아도 계속)', type: 'checkbox', checked: settings.runInBackground !== false, click: (item) => { settings.runInBackground = item.checked; saveSettings(settings); mainWindow?.webContents.send('settings-updated', toPublicSettings(settings)); updateTrayMenu() } },
    { type: 'separator' },
    { label: '종료', click: () => { isAppQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu)
}

// ── 창 생성 ──────────────────────────────────────────────────
function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: false, focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, contextIsolation: true
    }
  })

  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setIgnoreMouseEvents(true, { forward: true })
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    startSystemMonitor()
    startBreakTimer(settings.breakInterval)
    createTray()
  })

  // 닫기 → 설정에 따라 트레이로 최소화 또는 종료
  mainWindow.on('close', (e) => {
    if (!isAppQuitting) {
      if (settings.runInBackground !== false) {
        e.preventDefault()
        mainWindow?.hide()
        new Notification({ title: settings.petName || '뭉이', body: '트레이에서 계속 실행 중이에요 🐾' }).show()
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url); return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── LLM 호출 함수 ───────────────────────────────────────────

function parseModelResponse(raw: string): { text: string; actions: unknown[] } {
  let text = raw, actions: unknown[] = []
  try {
    const parsed = JSON.parse(raw.replace(/^```json\n?/, '').replace(/\n?```$/, ''))
    text = parsed.text || raw
    actions = Array.isArray(parsed.actions) ? parsed.actions : []
  } catch {}
  return { text, actions }
}

async function chatWithGemini(sessionId: string, userMessage: string, petName: string) {
  // 설정에 넣은 키가 우선. .env는 개발할 때 쓰는 폴백이다. 패키징된 앱은
  // cwd가 / 이라 dotenv가 .env를 찾지 못하므로 설정 쪽이 유일한 경로가 된다.
  const apiKey = revealApiKey(settings.geminiApiKey) || process.env['GEMINI_API_KEY'] || ''
  const modelId = settings.geminiModel?.trim() || process.env['GEMINI_MODEL'] || 'gemini-2.5-flash'
  if (!apiKey) {
    return { error: '설정 탭에서 Gemini API 키를 넣어주세요 🥺' }
  }
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: modelId, systemInstruction: getSystemPrompt(petName) })
  const history = chatHistories.get(sessionId) || []
  const chatSession = model.startChat({ history })
  const result = await chatSession.sendMessage(userMessage)
  const raw = result.response.text().trim()
  chatHistories.set(sessionId, trimHistory([
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
    { role: 'model', parts: [{ text: raw }] },
  ]))
  return parseModelResponse(raw)
}

async function chatWithOllama(sessionId: string, userMessage: string, petName: string) {
  const ollamaModel = process.env['OLLAMA_MODEL'] || 'qwen3.5'
  const ollamaUrl = process.env['OLLAMA_URL'] || 'http://localhost:11434'
  const history = ollamaChatHistories.get(sessionId) || []
  const messages = [
    { role: 'system', content: getSystemPrompt(petName) },
    ...history,
    { role: 'user', content: userMessage }
  ]
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, messages, stream: false })
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${res.statusText}`)
  const data = await res.json() as { message?: { content?: string } }
  const raw = (data.message?.content ?? '').trim()
  if (!raw) return { error: 'Ollama 응답이 비어있어요.' }
  ollamaChatHistories.set(sessionId, trimHistory([
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: raw },
  ]))
  return parseModelResponse(raw)
}

// ── Python NLP 엔진 ─────────────────────────────────────────

let pyProc: ChildProcess | null = null
const pyCallbacks = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let pyReqId = 0
/** 인터프리터를 찾을 수 없다고 확인되면 재시도하지 않고 즉시 안내한다. */
let pyUnavailableReason: string | null = null

const PY_MISSING_MSG = 'Python 엔진을 쓸 수 없어요. python3 설치 후 pip3 install -r python/requirements.txt 를 실행해주세요 🥺'

/** 대기 중인 모든 요청을 같은 이유로 실패시킨다. */
function rejectAllPyCallbacks(message: string) {
  for (const cb of Array.from(pyCallbacks.values())) cb.reject(new Error(message))
  pyCallbacks.clear()
}

function getPythonPath(): string {
  const pythonDir = app.isPackaged
    ? join(process.resourcesPath, 'python')
    : join(app.getAppPath(), 'python')
  return join(pythonDir, 'main.py')
}

function spawnPython(): void {
  if (pyProc) return
  const scriptPath = getPythonPath()
  if (!existsSync(scriptPath)) {
    pyUnavailableReason = `python/main.py 를 찾을 수 없어요 (${scriptPath})`
    console.warn('[Python]', pyUnavailableReason)
    return
  }

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  pyProc = spawn(pythonCmd, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })

  // 'error' 리스너가 없으면 인터프리터를 못 찾았을 때 Node가 예외를 던져 앱이 죽는다.
  pyProc.on('error', (err) => {
    console.warn('[Python] 실행 실패:', err.message)
    pyProc = null
    pyUnavailableReason = PY_MISSING_MSG
    rejectAllPyCallbacks(PY_MISSING_MSG)
  })

  pyProc.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const resp = JSON.parse(line)
        const id = resp._id as number | undefined
        if (id != null && pyCallbacks.has(id)) {
          const cb = pyCallbacks.get(id)!
          pyCallbacks.delete(id)
          if (resp.error) cb.reject(new Error(resp.error))
          else cb.resolve(resp.result)
        }
      } catch {}
    }
  })

  pyProc.stderr?.on('data', (chunk: Buffer) => {
    console.warn('[Python stderr]', chunk.toString('utf-8').trim())
  })

  pyProc.on('exit', (code) => {
    console.log('[Python] 종료 (code:', code, ')')
    pyProc = null
    rejectAllPyCallbacks('Python 엔진이 예상치 못하게 종료됐어요.')
  })
}

function callPython(task: string, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (pyUnavailableReason) return reject(new Error(pyUnavailableReason))

    if (!pyProc?.stdin?.writable) {
      spawnPython()
      if (!pyProc?.stdin?.writable) {
        return reject(new Error(pyUnavailableReason || PY_MISSING_MSG))
      }
    }

    const id = ++pyReqId
    // 응답이 오면 타임아웃 타이머도 함께 정리해야 죽은 타이머가 쌓이지 않는다.
    const timeout = setTimeout(() => {
      pyCallbacks.delete(id)
      reject(new Error('Python 응답 시간 초과 (10초)'))
    }, 10000)

    pyCallbacks.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v) },
      reject: (e) => { clearTimeout(timeout); reject(e) },
    })

    pyProc!.stdin!.write(JSON.stringify({ task, input, _id: id }) + '\n')
  })
}

// ── IPC 핸들러 ──────────────────────────────────────────────
app.whenReady().then(() => {
  // LLM 채팅 (Gemini / Ollama 분기)
  ipcMain.handle('gemini-chat', async (_event, sessionId: string, userMessage: string) => {
    settings = loadSettings()
    const provider = (process.env['LLM_PROVIDER'] || 'gemini').toLowerCase()
    const petName = settings.petName || '뭉이'
    try {
      if (provider === 'ollama') {
        return await chatWithOllama(sessionId, userMessage, petName)
      }
      return await chatWithGemini(sessionId, userMessage, petName)
    } catch (err: unknown) {
      console.error('LLM error:', err)
      const status = (err as { status?: number })?.status
      const msg = (err as { message?: string })?.message ?? ''
      if (status === 429 || /quota|Too Many Requests|한도|limit/i.test(msg)) {
        return { error: '오늘 요청 한도를 다 썼어요 😢 잠시 뒤에 다시 시도하거나, Google AI Studio에서 사용량을 확인해주세요.' }
      }
      if (/ECONNREFUSED|fetch failed/i.test(msg)) {
        return { error: 'Ollama 서버에 연결할 수 없어요. ollama serve가 실행 중인지 확인해주세요 🥺' }
      }
      return { error: '앗, 통신 오류가 났어요 주인님~ 😢' }
    }
  })

  // Python NLP 엔진
  ipcMain.handle('run-python', async (_event, payload: { task: string; input: unknown }) => {
    try {
      const result = await callPython(payload.task, payload.input)
      return { result }
    } catch (err: unknown) {
      return { error: (err as Error).message || 'Python 오류' }
    }
  })

  ipcMain.handle('show-notification', (_event, title: string, body: string) => {
    new Notification({ title, body }).show()
  })

  // 예약 알람 (메인 프로세스 타이머 사용)
  ipcMain.handle('schedule-alarm', (_event, payload: { id: string; label: string; delayMs: number; title?: string }) => {
    scheduleAlarm(payload.id, payload.label, payload.delayMs, payload.title)
  })

  ipcMain.handle('cancel-alarm', (_event, id: string) => cancelAlarm(id))

  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.handle('get-screen-size', () => screen.getPrimaryDisplay().workAreaSize)

  // 날씨: 고른 지역이 없으면 아무 데도 묻지 않는다.
  ipcMain.handle('fetch-weather', async () => {
    if (!settings.weatherPlace) return null
    try {
      return await currentWeather(settings.weatherPlace)
    } catch (e) {
      console.warn('[날씨] 로드 실패:', e)
      return null
    }
  })
  ipcMain.handle('search-place', async (_e, query: string) => {
    try { return await searchPlace(query) } catch { return [] }
  })

  // 캘린더
  ipcMain.handle('add-calendar', (_e, name: string, url: string) => addCalendar(name, url))
  ipcMain.handle('remove-calendar', (_e, index: number) => removeCalendar(index))
  ipcMain.handle('refresh-calendars', () => refreshCalendars())
  ipcMain.handle('get-upcoming-events', (_e, days: number) => {
    const now = Date.now()
    return upcomingEvents(now, now + Math.min(31, Math.max(1, days)) * 86_400_000)
      .slice(0, 60)
      .map(({ title, start, allDay, source }) => ({ title, start, allDay, source }))
  })

  ipcMain.on('cpu-update', () => {}) // 하위 호환

  // 설정
  ipcMain.handle('get-settings', () => toPublicSettings(settings))
  ipcMain.handle('save-settings', (_event, patch: SettingsPatch) => {
    // 캐릭터는 import-character로만 바뀐다. 렌더러가 들고 있던 옛 값으로 덮지 않는다.
    // 캘린더도 add-calendar / remove-calendar 로만 바뀐다(렌더러는 주소를 모른다).
    const { geminiApiKey, geminiApiKeySet: _k, aiReady: _a, character: _c, calendars: _cal, ...rest } = patch
    const next: StoredSettings = {
      ...settings,
      ...rest,
      petName: (patch.petName ?? '').trim(),
      petSize: Math.min(2, Math.max(0.5, Number(patch.petSize) || 1)),
      calendarAlertMinutes: (patch.calendarAlertMinutes ?? settings.calendarAlertMinutes)
        .map(Number).filter((m) => Number.isInteger(m) && m > 0 && m <= 1440),
    }
    // geminiApiKey가 아예 안 오면 기존 키를 유지하고, 빈 문자열로 오면 지운다.
    if (geminiApiKey !== undefined) {
      next.geminiApiKey = geminiApiKey.trim() ? protectApiKey(geminiApiKey.trim()) : undefined
    }
    settings = next
    saveSettings(settings)
    startBreakTimer(settings.breakInterval)
    applyLoginItemSetting(settings.startAtLogin)
    updateTrayMenu()
    scheduleCalendarAlerts()
    const view = toPublicSettings(settings)
    mainWindow?.webContents.send('settings-updated', view)
    return view
  })

  ipcMain.handle('import-character', importCharacter)
  ipcMain.handle('remove-character', removeCharacter)
  ipcMain.handle('get-character-sheet', readCharacterSheet)
  ipcMain.on('show-pet-menu', showPetMenu)

  createWindow()

  // 렌더러가 뜰 시간을 조금 준 뒤 시작한다.
  setTimeout(checkWorkHours, 8000)
  setInterval(checkWorkHours, 30_000)
  refreshCalendars()
  setInterval(refreshCalendars, CALENDAR_REFRESH_MS)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (cpuTimer) clearTimeout(cpuTimer)
  if (breakTimer) clearTimeout(breakTimer)
  if (!loadSettings().runInBackground || process.platform !== 'darwin') {
    app.quit()
  }
})

// Cmd+Q / 독 종료로 들어오면 창의 close 핸들러가 트레이로 숨기지 않도록 표시해준다.
app.on('before-quit', () => {
  isAppQuitting = true
  clearAllAlarms()
  if (pyProc) { pyProc.kill(); pyProc = null }
})

