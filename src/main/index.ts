import { app, shell, BrowserWindow, ipcMain, screen, Notification, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { config } from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { spawn, ChildProcess } from 'child_process'
import os from 'os'

config()

// ── 단일 인스턴스 (lock 파일 + Electron lock 이중 적용) ────────
const LOCK_PATH = join(app.getPath('userData'), '.single-instance.lock')

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tryAcquireLock(): boolean {
  if (existsSync(LOCK_PATH)) {
    try {
      const pid = parseInt(readFileSync(LOCK_PATH, 'utf-8').trim(), 10)
      if (!isNaN(pid) && isPidRunning(pid)) return false
    } catch {}
    try { unlinkSync(LOCK_PATH) } catch {}
  }
  try {
    writeFileSync(LOCK_PATH, String(process.pid))
    return true
  } catch {
    return false
  }
}

function releaseLock() {
  try {
    if (existsSync(LOCK_PATH) && readFileSync(LOCK_PATH, 'utf-8').trim() === String(process.pid)) {
      unlinkSync(LOCK_PATH)
    }
  } catch {}
}

const gotLock = app.requestSingleInstanceLock() && tryAcquireLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('will-quit', releaseLock)

// ── 설정 파일 ──────────────────────────────────────────────
const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

interface AppSettings {
  breakInterval: number
  startAtLogin: boolean
  petSpeed: number
  petName: string         // 펫 이름 (기본 뭉이)
  voiceEnabled: boolean   // TTS 켜기
  runInBackground: boolean // 창 닫아도 트레이에서 계속 실행
}

const DEFAULT_SETTINGS: AppSettings = { breakInterval: 90, startAtLogin: false, petSpeed: 1, petName: '뭉이', voiceEnabled: false, runInBackground: true }

function loadSettings(): AppSettings {
  try {
    if (existsSync(SETTINGS_PATH)) return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) }
  } catch {}
  return { ...DEFAULT_SETTINGS }
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

function saveSettings(s: AppSettings) {
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

// ── 트레이 ──────────────────────────────────────────────────
function createTray() {
  try {
    const spritePath = join(app.getAppPath(), 'src/renderer/src/assets/pet-sprite.png')
    const icon = nativeImage.createFromPath(spritePath).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
  } catch {
    tray = new Tray(nativeImage.createEmpty())
  }

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
    { label: '휴식 알림 끄기', type: 'checkbox', checked: settings.breakInterval === 0, click: (item) => { settings.breakInterval = item.checked ? 0 : 90; saveSettings(settings); startBreakTimer(settings.breakInterval); mainWindow?.webContents.send('settings-updated', settings) } },
    { label: '로그인 시 자동 시작', type: 'checkbox', checked: settings.startAtLogin, click: (item) => { settings.startAtLogin = item.checked; saveSettings(settings); if (!applyLoginItemSetting(item.checked)) { mainWindow?.webContents.send('settings-updated', settings); updateTrayMenu() } } },
    { label: '백그라운드 실행 (창 닫아도 계속)', type: 'checkbox', checked: settings.runInBackground !== false, click: (item) => { settings.runInBackground = item.checked; saveSettings(settings); mainWindow?.webContents.send('settings-updated', settings); updateTrayMenu() } },
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
  const apiKey = process.env['VITE_GEMINI_API_KEY']
  const modelId = process.env['VITE_GEMINI_MODEL']
  if (!apiKey || !modelId) {
    return { error: '.env에서 VITE_GEMINI_API_KEY / VITE_GEMINI_MODEL을 확인해주세요 🥺' }
  }
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: modelId, systemInstruction: getSystemPrompt(petName) })
  const history = chatHistories.get(sessionId) || []
  const chatSession = model.startChat({ history })
  const result = await chatSession.sendMessage(userMessage)
  const raw = result.response.text().trim()
  chatHistories.set(sessionId, [...history, { role: 'user', parts: [{ text: userMessage }] }, { role: 'model', parts: [{ text: raw }] }])
  return parseModelResponse(raw)
}

async function chatWithOllama(sessionId: string, userMessage: string, petName: string) {
  const ollamaModel = process.env['VITE_OLLAMA_MODEL'] || 'qwen3.5'
  const ollamaUrl = process.env['VITE_OLLAMA_URL'] || 'http://localhost:11434'
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
  ollamaChatHistories.set(sessionId, [...history, { role: 'user', content: userMessage }, { role: 'assistant', content: raw }])
  return parseModelResponse(raw)
}

// ── Python NLP 엔진 ─────────────────────────────────────────

let pyProc: ChildProcess | null = null
let pyReady = false
const pyCallbacks = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let pyReqId = 0

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
    console.warn('[Python] main.py not found:', scriptPath)
    return
  }

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  pyProc = spawn(pythonCmd, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
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
    console.log('[Python] exited with code', code)
    pyProc = null
    pyReady = false
    for (const [, cb] of pyCallbacks) cb.reject(new Error('Python process exited'))
    pyCallbacks.clear()
  })

  pyReady = true
}

function callPython(task: string, input: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!pyProc?.stdin?.writable) {
      spawnPython()
      if (!pyProc?.stdin?.writable) {
        return reject(new Error('Python 엔진을 시작할 수 없어요. python3이 설치되어 있는지 확인해주세요.'))
      }
    }
    const id = ++pyReqId
    pyCallbacks.set(id, { resolve, reject })

    const payload = JSON.stringify({ task, input, _id: id }) + '\n'
    pyProc!.stdin!.write(payload)

    setTimeout(() => {
      if (pyCallbacks.has(id)) {
        pyCallbacks.delete(id)
        reject(new Error('Python 응답 시간 초과 (10초)'))
      }
    }, 10000)
  })
}

// ── IPC 핸들러 ──────────────────────────────────────────────
app.whenReady().then(() => {
  // LLM 채팅 (Gemini / Ollama 분기)
  ipcMain.handle('gemini-chat', async (_event, sessionId: string, userMessage: string) => {
    settings = loadSettings()
    const provider = (process.env['VITE_LLM_PROVIDER'] || 'gemini').toLowerCase()
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

  ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean) => {
    mainWindow?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.handle('get-screen-size', () => screen.getPrimaryDisplay().workAreaSize)

  // 날씨 (ipapi 실패 시 서울 기본값으로 재시도)
  ipcMain.handle('fetch-weather', async () => {
    const tryFetch = async (lat: number, lon: number) => {
      const wxRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`
      )
      const wx = await wxRes.json()
      const temp = Math.round(wx.current.temperature_2m)
      const code = wx.current.weather_code
      const { emoji, desc } = weatherFromCode(code, temp)
      return { temp, code, emoji, desc }
    }
    try {
      const locRes = await fetch('https://ipapi.co/json/')
      const loc = await locRes.json()
      let lat = loc.latitude, lon = loc.longitude
      if (lat != null && lon != null) {
        return await tryFetch(lat, lon)
      }
    } catch {}
    try {
      return await tryFetch(37.5665, 126.9780) // ipapi 실패 시 서울
    } catch (e) {
      console.warn('[날씨] 로드 실패:', e)
      return null
    }
  })

  ipcMain.on('cpu-update', () => {}) // 하위 호환

  ipcMain.handle('get-sprite-base64', () => {
    const spritePath = join(app.getAppPath(), 'src/renderer/src/assets/pet-sprite.png')
    try { return `data:image/png;base64,${readFileSync(spritePath).toString('base64')}` } catch { return null }
  })

  // 설정
  ipcMain.handle('get-settings', () => settings)
  ipcMain.handle('save-settings', (_event, newSettings: AppSettings) => {
    const normalized = { ...newSettings, petName: (newSettings.petName ?? '').trim() }
    settings = { ...settings, ...normalized }
    saveSettings(settings)
    startBreakTimer(settings.breakInterval)
    applyLoginItemSetting(settings.startAtLogin)
    updateTrayMenu()
    mainWindow?.webContents.send('settings-updated', settings)
    return settings
  })

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (cpuTimer) clearTimeout(cpuTimer)
  if (breakTimer) clearTimeout(breakTimer)
  if (!loadSettings().runInBackground || process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (pyProc) { pyProc.kill(); pyProc = null }
})

