import { useState, useEffect, useCallback, useRef } from 'react'
import { Pet } from './components/Pet'
import { ChatBubble, ChatMessage } from './components/ChatBubble'
import { Pomodoro } from './components/Pomodoro'
import { TodoList, Todo } from './components/TodoList'
import { Settings } from './components/Settings'
import { CalendarView } from './components/CalendarView'
import { ResizablePanel } from './components/ResizablePanel'
import { useGemini, PetEmotion } from './hooks/useGemini'
import { usePomodoro } from './hooks/usePomodoro'
import { useWeather } from './hooks/useWeather'
import { useFocusLog, dayKey } from './hooks/useFocusLog'
import { Character, DOG, fromPetsSheet } from './pet/character'
import { PetPrompt } from './components/Pet'
import './styles/global.css'

const STORAGE_KEY = 'mungyi-todos'
// 하루에 한 번만 하는 일(어제 남은 할 일 묻기, 절반·전부 응원)을 했는지 적어 둔다.
const DAILY_KEY = 'mungyi-daily'
type Tab = 'chat' | 'pomo' | 'todo' | 'cal' | 'settings'

/** AI 없이도 바로 답하는 질문. 말 걸기 창과 채팅 탭에 버튼으로 띄운다. */
const CHIPS = ['할 일 뭐 남았어?', '집중 시작!', '다음 일정은?', '오늘 날씨?', '응원해 줘', '춤춰 줘', '가위바위보']

interface Daily { day: string; asked?: boolean; half?: boolean; all?: boolean }
function loadDaily(): Daily {
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}') as Daily
    if (d.day === dayKey()) return d
  } catch {}
  return { day: dayKey() }
}
function saveDaily(patch: Partial<Daily>) {
  localStorage.setItem(DAILY_KEY, JSON.stringify({ ...loadDaily(), ...patch }))
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

function formatEvent(e: UpcomingEvent): string {
  const d = new Date(e.start)
  const today = new Date()
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const day = sameDay(d, today) ? '오늘' : sameDay(d, tomorrow) ? '내일' : `${d.getMonth() + 1}/${d.getDate()}`
  const time = e.allDay ? '종일' : d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
  return `${day} ${time} · ${e.title}`
}
const CHEERS = [
  '주인님은 지금도 충분히 잘하고 있어요! 💪',
  '조금만 쉬었다 하면 더 잘 될 거예요 🍀',
  '제가 옆에서 지켜보고 있을게요 🐾',
  '오늘 한 것만으로도 대단해요! ✨',
]
const SPEECH_MAX = 120

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

async function loadCharacter(s: AppSettings): Promise<Character> {
  if (!s.character) return DOG
  const sheet = await window.electronAPI.getCharacterSheet()
  return sheet ? fromPetsSheet(sheet, s.character) : DOG
}

export default function App() {
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'pet', text: '안녕하세요 주인님~ 저 뭉이예요! 알람, 할일 추가도 말만 해요 🐾' }
  ])
  const [todos, setTodos] = useState<Todo[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
  })
  const [cpuUsage, setCpuUsage] = useState(0)
  const [ramInfo, setRamInfo] = useState<SystemStats['ram'] | null>(null)
  const [alarmMsg, setAlarmMsg] = useState<string | null>(null)
  const [petSpeed, setPetSpeed] = useState(1)
  const [petName, setPetName] = useState('뭉이')
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [weatherGreeting, setWeatherGreeting] = useState<string | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [petSize, setPetSize] = useState(1)
  const [aiReady, setAiReady] = useState(true)
  const [speech, setSpeech] = useState<{ text: string; at: number } | null>(null)
  const [talkSignal, setTalkSignal] = useState(0)
  const [danceSignal, setDanceSignal] = useState(0)
  const [clickTalk, setClickTalk] = useState(false)
  const [placeKey, setPlaceKey] = useState<string | null>(null)
  const [calendarCount, setCalendarCount] = useState(0)
  const [prompt, setPrompt] = useState<(PetPrompt & { kind: string }) | null>(null)

  const { chat, isLoading, emotion, setEmotion } = useGemini()
  const weather = useWeather(placeKey)

  // handleSend는 messages를 의존성에 두지 않는다(메시지마다 콜백이 재생성되므로).
  // 대신 ref로 최신 값을 읽어 분석 명령어가 옛 스냅샷을 쓰지 않게 한다.
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const todosRef = useRef(todos)
  todosRef.current = todos

  const handlePomoFinish = useCallback((msg: string) => {
    setMessages(prev => [...prev, { role: 'pet', text: msg }])
    setAlarmMsg(msg)
    setEmotion('excited')
  }, [setEmotion])

  const { state: pomoState, controls: pomoControls } = usePomodoro(handlePomoFinish)
  const focusLog = useFocusLog(pomoState)

  const sayPet = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'pet', text }])
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  // 오늘 꼭 할 일의 절반·전부를 끝낸 순간에 하루 한 번씩 응원한다.
  useEffect(() => {
    const t0 = startOfToday()
    const today = todos.filter(t => !t.later && (!t.done || (t.doneAt ?? 0) >= t0))
    const doneCount = today.filter(t => t.done).length
    if (today.length < 2 || doneCount === 0) return
    const daily = loadDaily()
    if (doneCount === today.length && !daily.all) {
      saveDaily({ all: true, half: true })
      sayPet(`오늘 할 일 ${today.length}개 다 끝냈어요! 최고예요 🎉`)
      setDanceSignal(n => n + 1)
    } else if (doneCount * 2 >= today.length && doneCount < today.length && !daily.half) {
      saveDaily({ half: true })
      sayPet(`벌써 절반 끝! ${today.length - doneCount}개만 더 하면 돼요 💪`)
      setEmotion('excited')
    }
  }, [todos, sayPet, setEmotion])

  // 하루 처음 켤 때(또는 날이 바뀔 때) 어제 못 끝낸 할 일을 오늘도 할지 묻는다.
  useEffect(() => {
    const check = () => {
      if (loadDaily().asked) return
      const left = todosRef.current.filter(t => !t.done && !t.later && t.id < startOfToday())
      saveDaily({ asked: true })
      if (!left.length) return
      setPrompt({
        kind: 'leftover',
        text: `어제 남은 할 일 ${left.length}개, 오늘도 할까요?`,
        actions: [{ label: '오늘도 할게', value: 'keep' }, { label: '나중으로', value: 'later' }],
      })
    }
    const first = setTimeout(check, 4000)
    const t = setInterval(check, 10 * 60 * 1000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [])

  const handlePrompt = useCallback((value: string) => {
    if (prompt?.kind === 'leftover') {
      const t0 = startOfToday()
      if (value === 'later') {
        setTodos(prev => prev.map(t => (!t.done && !t.later && t.id < t0 ? { ...t, later: true } : t)))
        sayPet('나중에 할 일로 옮겨 뒀어요. 오늘은 새로 시작해요 🌱')
      } else {
        sayPet('좋아요! 오늘도 같이 해요 💪')
        setEmotion('excited')
      }
    }
    setPrompt(null)
  }, [prompt, sayPet, setEmotion])

  // 메인이 시키는 말 (출근·점심·퇴근 인사)
  useEffect(() => {
    window.electronAPI.onPetSay(({ text, emotion }) => {
      sayPet(text)
      setEmotion(emotion as PetEmotion)
      setTimeout(() => setEmotion('idle'), 3000)
    })
    return () => window.electronAPI.offPetSay()
  }, [sayPet, setEmotion])

  // 시스템 통계
  useEffect(() => {
    window.electronAPI.onSystemStats((stats) => {
      setCpuUsage(stats.cpu)
      setRamInfo(stats.ram)
    })
    return () => window.electronAPI.offSystemStats()
  }, [])

  // 휴식 알림
  useEffect(() => {
    window.electronAPI.onBreakReminder((minutes) => {
      const msg = `${minutes}분 동안 일했어요! 주인님, 잠깐 쉬어요 💆`
      setMessages(prev => [...prev, { role: 'pet', text: msg }])
      setAlarmMsg(msg)
      setEmotion('love')
    })
    return () => window.electronAPI.offBreakReminder()
  }, [setEmotion])

  // 메인 프로세스에서 예약 알람이 울리면 UI에 반영 (알림 자체는 메인이 이미 발송)
  useEffect(() => {
    window.electronAPI.onAlarmFired(({ id, label }) => {
      // 일정 알림은 화면을 덮지 않고 말풍선으로만 알린다(알림 센터에는 메인이 이미 띄웠다).
      if (id.startsWith('cal:')) {
        setMessages(prev => [...prev, { role: 'pet', text: `📅 ${label}` }])
        setEmotion('excited')
        setTimeout(() => setEmotion('idle'), 3000)
        return
      }
      setAlarmMsg(`⏰ ${label}`)
      setMessages(prev => [...prev, { role: 'pet', text: `⏰ ${label}` }])
      setEmotion('excited')
    })
    return () => window.electronAPI.offAlarmFired()
  }, [setEmotion])

  // 알람 오버레이는 표시 후 자동으로 닫는다
  useEffect(() => {
    if (!alarmMsg) return
    const t = setTimeout(() => { setAlarmMsg(null); setEmotion('idle') }, 6000)
    return () => clearTimeout(t)
  }, [alarmMsg, setEmotion])

  // 설정 로드. 캐릭터 시트 파일이 바뀌었을 때만 그림을 다시 읽는다.
  const characterFile = useRef<string | undefined>()
  useEffect(() => {
    const apply = (s: AppSettings, first: boolean) => {
      setPetSpeed(s.petSpeed ?? 1)
      setPetName(s.petName ?? '')
      setVoiceEnabled(s.voiceEnabled ?? false)
      setPetSize(s.petSize ?? 1)
      setAiReady(s.aiReady)
      setClickTalk(!!s.clickTalk)
      setPlaceKey(s.weatherPlace ? `${s.weatherPlace.latitude},${s.weatherPlace.longitude}` : null)
      setCalendarCount(s.calendars?.length ?? 0)
      if (first || s.character?.file !== characterFile.current) {
        characterFile.current = s.character?.file
        loadCharacter(s).then(setCharacter)
      }
    }
    window.electronAPI.getSettings().then(s => {
      apply(s, true)
      setMessages(prev => {
        if (prev.length && prev[0].role === 'pet')
          return [{ ...prev[0], text: `안녕하세요 주인님~ 저 ${s.petName?.trim() || '뭉이'}예요! 알람, 할일 추가도 말만 해요 🐾` }, ...prev.slice(1)]
        return prev
      })
    })
    window.electronAPI.onSettingsUpdated(s => apply(s, false))
    return () => window.electronAPI.offSettingsUpdated()
  }, [])

  // 패널이 닫혀 있을 때 펫이 한 말은 머리 위 말풍선으로 보여준다.
  const shownCount = useRef(messages.length)
  useEffect(() => {
    const added = messages.length > shownCount.current
    shownCount.current = messages.length
    const last = messages[messages.length - 1]
    if (!added || panelOpen || last?.role !== 'pet') return
    const text = last.text.length > SPEECH_MAX ? last.text.slice(0, SPEECH_MAX) + '…' : last.text
    setSpeech({ text, at: Date.now() })
  }, [messages, panelOpen])

  const openPanel = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setPanelOpen(true)
    window.electronAPI.setIgnoreMouseEvents(false)
  }, [])

  useEffect(() => {
    window.electronAPI.onPetMenu((action) => {
      if (action === 'talk') setTalkSignal(n => n + 1)
      else if (action === 'chat' || action === 'todo' || action === 'pomo' || action === 'cal' || action === 'settings') openPanel(action)
    })
    return () => window.electronAPI.offPetMenu()
  }, [openPanel])

  // 날씨 반응 - 날씨 로드되면 idle 말풍선에 6초만 표시 (한 번만)
  const weatherShownRef = useRef(false)
  useEffect(() => {
    if (!weather || weatherShownRef.current) return
    weatherShownRef.current = true
    const msg = `${weather.place} 날씨는 ${weather.emoji} ${weather.desc}이에요! 기온은 ${weather.temp}°C 주인님~`
    setWeatherGreeting(msg)
    setTimeout(() => setWeatherGreeting(null), 6000)
  }, [weather])

  const handleTogglePanel = useCallback(() => {
    setPanelOpen(prev => {
      const next = !prev
      window.electronAPI.setIgnoreMouseEvents(!next)
      return next
    })
    setEmotion('happy')
    setTimeout(() => setEmotion('idle'), 1200)
  }, [setEmotion])

  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !text.trim()) return
    if (typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.rate = 0.95
    speechSynthesis.speak(u)
  }, [voiceEnabled])

  const handleSend = useCallback(async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', text }])
    const t = text.trim()

    // 가위바위보
    if (/^가위$|^바위$|^보$/i.test(t)) {
      const choices = ['가위', '바위', '보'] as const
      const mine = choices[Math.floor(Math.random() * 3)]
      const userIdx = choices.indexOf(t as typeof choices[number])
      const myIdx = choices.indexOf(mine)
      let result: string
      if (userIdx === myIdx) result = `비겼어요! 저도 ${mine} 냈어요~`
      else if ((userIdx + 1) % 3 === myIdx) result = `제가 이겼어요! ${mine} 냈어요 ㅎㅎ`
      else result = `주인님이 이기셨어요! 저는 ${mine} 냈어요 ㅠㅠ`
      setMessages(prev => [...prev, { role: 'pet', text: result }])
      speak(result)
      return
    }

    // Python NLP 분석 명령어
    if (/^(기분|감정)\s*(분석|리포트|보고서)?$/i.test(t)) {
      const userMsgs = messagesRef.current.filter(m => m.role === 'user').map(m => m.text)
      if (userMsgs.length < 2) {
        const msg = '대화를 좀 더 나눠야 분석할 수 있어요! 🐾'
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(msg)
        return
      }
      try {
        const res = await window.electronAPI.runPython({ task: 'mood', input: { messages: userMsgs } })
        if (res.error) throw new Error(res.error)
        const r = res.result as { emoji: string; avg_score: number; message_count: number; trend_text: string }
        const msg = `${r.emoji} 주인님 기분 분석 결과!\n📊 평균 점수: ${r.avg_score} (메시지 ${r.message_count}개)\n${r.trend_text}`
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(msg.replace(/\n/g, '. '))
      } catch {
        setMessages(prev => [...prev, { role: 'pet', text: 'Python 분석 엔진에 연결할 수 없어요 🥺 python3과 kiwipiepy가 설치돼 있는지 확인해주세요!' }])
      }
      return
    }

    if (/^키워드\s*(분석|추출)?$/i.test(t)) {
      const allText = messagesRef.current.filter(m => m.role === 'user').map(m => m.text).join(' ')
      if (allText.trim().length < 10) {
        const msg = '키워드를 뽑으려면 대화가 더 필요해요! 🐾'
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(msg)
        return
      }
      try {
        const res = await window.electronAPI.runPython({ task: 'keywords', input: { text: allText, top_n: 5 } })
        if (res.error) throw new Error(res.error)
        const keywords = res.result as Array<{ word: string; count: number; score: number }>
        const list = keywords.map((k, i) => `${i + 1}. ${k.word} (${k.count}회)`).join('\n')
        const msg = `🔑 주인님 대화 키워드 TOP ${keywords.length}!\n${list}`
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(`주인님이 가장 많이 말한 키워드는 ${keywords[0]?.word}이에요!`)
      } catch {
        setMessages(prev => [...prev, { role: 'pet', text: 'Python 분석 엔진에 연결할 수 없어요 🥺' }])
      }
      return
    }

    if (/^감정\s*(분석)?\s+.+/i.test(t)) {
      const targetText = t.replace(/^감정\s*(분석)?\s+/, '')
      try {
        const res = await window.electronAPI.runPython({ task: 'sentiment', input: { text: targetText } })
        if (res.error) throw new Error(res.error)
        const r = res.result as { emoji: string; label: string; score: number; positive: number; negative: number }
        const labels: Record<string, string> = { positive: '긍정', negative: '부정', neutral: '중립' }
        const msg = `${r.emoji} 감정 분석 결과: ${labels[r.label] || r.label} (점수: ${r.score})\n긍정 ${r.positive}개 / 부정 ${r.negative}개`
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(msg.replace(/\n/g, '. '))
      } catch {
        setMessages(prev => [...prev, { role: 'pet', text: 'Python 분석 엔진에 연결할 수 없어요 🥺' }])
      }
      return
    }

    const reply = (msg: string) => {
      setMessages(prev => [...prev, { role: 'pet', text: msg }])
      speak(msg)
    }

    if (t === '가위바위보') {
      reply('좋아요! 가위, 바위, 보 중에 하나 말해 줘요 ✊✌️🖐️')
      return
    }

    if (/^(할\s*일|투두).*(남|뭐|몇|알려|보여)/.test(t)) {
      const left = todosRef.current.filter(td => !td.done && !td.later)
      const later = todosRef.current.filter(td => !td.done && td.later).length
      const laterNote = later ? `\n(나중에 할 일 ${later}개는 따로 있어요)` : ''
      if (!left.length) {
        reply('오늘 꼭 할 일은 다 끝냈어요! 🎉' + laterNote)
        setEmotion('excited')
      } else {
        const top = [...left].sort((a, b) => Number(b.urgent) - Number(a.urgent)).slice(0, 3)
        reply(`오늘 할 일이 ${left.length}개 남았어요!\n` + top.map(td => `${td.urgent ? '🔥' : '•'} ${td.text}`).join('\n') + laterNote)
      }
      return
    }

    if (/^춤/.test(t)) {
      reply(pick(['신난다~ 🎶', '보세요 제 춤 실력! 💃', '둠칫 둠칫 🕺']))
      setDanceSignal(n => n + 1)
      return
    }

    if (/(다음|오늘|내일|이번\s*주).*(일정|약속|회의|스케줄)/.test(t)) {
      if (!calendarCount) {
        reply('아직 연결한 캘린더가 없어요. 📅 캘린더 탭에서 ICS 주소를 넣어 주세요!')
        return
      }
      const events = await window.electronAPI.getUpcomingEvents(7)
      reply(events.length
        ? `다가오는 일정이에요 📅\n` + events.slice(0, 4).map(e => `• ${formatEvent(e)}`).join('\n')
        : '앞으로 일주일 동안 일정이 없어요! 🌿')
      return
    }

    if (/^(집중|뽀모도로?|포모도로?)\s*(시작|할래|하자|모드)?\s*!?$/.test(t)) {
      if (pomoState.running) {
        reply(`이미 집중하는 중이에요! ${Math.ceil(pomoState.seconds / 60)}분 남았어요 🍅`)
      } else {
        if (pomoState.phase !== 'work') pomoControls.switchPhase('work')
        pomoControls.toggle()
        reply(`${pomoState.config.workMinutes}분 집중 시작! 끝나면 알려줄게요 🍅`)
        setEmotion('excited')
      }
      return
    }

    if (/^응원/.test(t) || (!aiReady && /힘내|힘들|지쳐|우울|응원/.test(t))) {
      reply(pick(CHEERS))
      setEmotion('love')
      return
    }

    // 날씨 질문은 앱에서 직접 응답
    if (/날씨|weather|기온|(오늘|지금)\s*(날씨|날씨가)|날씨\s*(알려|어때|어떠냐|어때요|어떄)/i.test(t)) {
      if (!placeKey) {
        reply('어느 동네 날씨를 볼지 아직 몰라요. 설정 ⚙️ → 🌤️ 날씨에서 지역을 골라 주세요!')
        return
      }
      const wx = weather ?? await window.electronAPI.getWeather()
      if (wx) {
        const msg = `${wx.place} 날씨는 ${wx.emoji} ${wx.desc}이에요! 기온은 ${wx.temp}°C 주인님~`
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(msg)
        return
      }
      setMessages(prev => [...prev, { role: 'pet', text: '날씨를 불러오지 못했어요 ㅠㅠ 네트워크를 확인해주세요~ 🌤️' }])
      return
    }

    if (!aiReady) {
      reply('아직 AI 키가 없어서 자유 대화는 못 해요 🥺 설정에서 키를 넣으면 뭐든 얘기할 수 있어요! 그 전에는 아래 질문은 바로 대답할게요.')
      return
    }

    const result = await chat(text)
    setMessages(prev => [...prev, { role: 'pet', text: result.text }])
    speak(result.text)

    if (result.actions?.length) {
      result.actions.forEach((action) => {
        if (action.type === 'timer' && action.seconds) {
          const label = action.label || `${action.seconds}초 알람`
          const timeStr = action.seconds >= 60 ? `${Math.floor(action.seconds/60)}분` : `${action.seconds}초`
          setMessages(prev => [...prev, { role: 'pet', text: `⏰ ${timeStr} 뒤에 알려드릴게요!` }])
          // 렌더러 setTimeout은 창이 숨겨지면 스로틀링되므로 메인 프로세스에 예약한다.
          window.electronAPI.scheduleAlarm({
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label,
            delayMs: action.seconds * 1000,
          })
        }
        if (action.type === 'add_todo' && action.text) {
          setTodos(prev => [...prev, { id: Date.now(), text: action.text!, done: false, urgent: action.urgent || false }])
          setMessages(prev => [...prev, { role: 'pet', text: `📋 할일 탭에 추가했어요!` }])
        }
      })
    }
  }, [chat, setEmotion, weather, speak, aiReady, pomoState, pomoControls, placeKey, calendarCount])

  const handlePanelClose = useCallback(() => {
    setPanelOpen(false)
    window.electronAPI.setIgnoreMouseEvents(true)
  }, [])

  return (
    <div className="app-root">
      {alarmMsg && (
        <div className="alarm-overlay" onClick={() => setAlarmMsg(null)}>
          <div className="alarm-box">
            <div className="alarm-text">{alarmMsg}</div>
            <div className="alarm-dismiss">클릭해서 닫기</div>
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="panel-container">
          <ResizablePanel>
            <div className="panel-tabs">
              <button className={`tab-btn ${activeTab==='chat'?'active':''}`} onClick={()=>setActiveTab('chat')}>💬</button>
              <button className={`tab-btn ${activeTab==='pomo'?'active':''}`} onClick={()=>setActiveTab('pomo')}>🍅</button>
              <button className={`tab-btn ${activeTab==='todo'?'active':''}`} onClick={()=>setActiveTab('todo')}>
                📋{todos.filter(t=>!t.done).length>0&&<span className="todo-badge">{todos.filter(t=>!t.done).length}</span>}
              </button>
              <button className={`tab-btn ${activeTab==='cal'?'active':''}`} onClick={()=>setActiveTab('cal')}>📅</button>
              <button className={`tab-btn ${activeTab==='settings'?'active':''}`} onClick={()=>setActiveTab('settings')}>⚙️</button>
              <button className="close-btn" onClick={handlePanelClose}>×</button>
            </div>

            {/* 날씨 + RAM 상태바 */}
            {(weather || ramInfo) && (
              <div className="status-bar">
                {weather && <span>{weather.emoji} {weather.temp}°C</span>}
                {ramInfo && <span>💾 RAM {ramInfo.used}%</span>}
                {cpuUsage > 60 && <span>⚡ CPU {cpuUsage}%</span>}
              </div>
            )}

            <div className="panel-content">
              {activeTab==='chat' && <ChatBubble messages={messages} onSend={handleSend} isLoading={isLoading} petName={petName} chips={CHIPS} />}
              {activeTab==='pomo' && <Pomodoro state={pomoState} controls={pomoControls} focusLog={focusLog} />}
              {activeTab==='todo' && <TodoList todos={todos} setTodos={setTodos} />}
              {activeTab==='cal' && <CalendarView />}
              {activeTab==='settings' && <Settings />}
            </div>
          </ResizablePanel>
        </div>
      )}

      {character && (
        <Pet
          character={character}
          size={petSize}
          petName={petName}
          emotion={emotion}
          isLoading={isLoading}
          cpuUsage={cpuUsage}
          isPanelOpen={panelOpen}
          onTogglePanel={handleTogglePanel}
          onTalk={handleSend}
          chips={CHIPS}
          speech={speech}
          talkSignal={talkSignal}
          danceSignal={danceSignal}
          clickTalk={clickTalk}
          focus={pomoState.running ? {
            text: `${pomoState.phase === 'work' ? '🍅 집중 중' : '☕ 쉬는 중'} · ${String(Math.floor(pomoState.seconds / 60)).padStart(2, '0')}:${String(pomoState.seconds % 60).padStart(2, '0')}`,
            working: pomoState.phase === 'work',
          } : null}
          prompt={prompt}
          onPrompt={handlePrompt}
          speedMultiplier={petSpeed}
          weatherGreeting={weatherGreeting}
        />
      )}
    </div>
  )
}
