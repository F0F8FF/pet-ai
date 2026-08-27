import { useState, useEffect, useCallback, useRef } from 'react'
import { Pet } from './components/Pet'
import { ChatBubble, ChatMessage } from './components/ChatBubble'
import { Pomodoro } from './components/Pomodoro'
import { TodoList, Todo } from './components/TodoList'
import { Settings } from './components/Settings'
import { ResizablePanel } from './components/ResizablePanel'
import { useGemini } from './hooks/useGemini'
import { usePomodoro } from './hooks/usePomodoro'
import { useWeather } from './hooks/useWeather'
import './styles/global.css'

const STORAGE_KEY = 'mungyi-todos'
type Tab = 'chat' | 'pomo' | 'todo' | 'settings'

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

  const { chat, isLoading, emotion, setEmotion } = useGemini()
  const weather = useWeather()

  // handleSend는 messages를 의존성에 두지 않는다(메시지마다 콜백이 재생성되므로).
  // 대신 ref로 최신 값을 읽어 분석 명령어가 옛 스냅샷을 쓰지 않게 한다.
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const handlePomoFinish = useCallback((msg: string) => {
    setMessages(prev => [...prev, { role: 'pet', text: msg }])
    setAlarmMsg(msg)
    setEmotion('excited')
  }, [setEmotion])

  const { state: pomoState, controls: pomoControls } = usePomodoro(handlePomoFinish)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

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
    window.electronAPI.onAlarmFired(({ label }) => {
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

  // 설정 로드
  useEffect(() => {
    window.electronAPI.getSettings().then(s => {
      setPetSpeed(s.petSpeed ?? 1)
      setPetName(s.petName ?? '')
      setVoiceEnabled(s.voiceEnabled ?? false)
      setMessages(prev => {
        if (prev.length && prev[0].role === 'pet')
          return [{ ...prev[0], text: `안녕하세요 주인님~ 저 ${s.petName?.trim() || '뭉이'}예요! 알람, 할일 추가도 말만 해요 🐾` }, ...prev.slice(1)]
        return prev
      })
    })
  }, [])
  useEffect(() => {
    const unsub = (s: AppSettings) => { setPetName(s.petName ?? ''); setVoiceEnabled(s.voiceEnabled ?? false) }
    window.electronAPI.onSettingsUpdated(unsub)
    return () => window.electronAPI.offSettingsUpdated()
  }, [])

  // 날씨 반응 - 날씨 로드되면 idle 말풍선에 6초만 표시 (한 번만)
  const weatherShownRef = useRef(false)
  useEffect(() => {
    if (!weather || weatherShownRef.current) return
    weatherShownRef.current = true
    const msg = `오늘 날씨는 ${weather.emoji} ${weather.desc}이에요! 기온은 ${weather.temp}°C 주인님~`
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

    // 날씨 질문은 앱에서 직접 응답
    if (/날씨|weather|기온|(오늘|지금)\s*(날씨|날씨가)|날씨\s*(알려|어때|어떠냐|어때요|어떄)/i.test(t)) {
      const wx = weather ?? await window.electronAPI.getWeather()
      if (wx) {
        const msg = `오늘 날씨는 ${wx.emoji} ${wx.desc}이에요! 기온은 ${wx.temp}°C 주인님~`
        setMessages(prev => [...prev, { role: 'pet', text: msg }])
        speak(msg)
        return
      }
      setMessages(prev => [...prev, { role: 'pet', text: '날씨를 불러오지 못했어요 ㅠㅠ 네트워크를 확인해주세요~ 🌤️' }])
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
  }, [chat, setEmotion, weather, voiceEnabled, speak])

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
              {activeTab==='chat' && <ChatBubble messages={messages} onSend={handleSend} isLoading={isLoading} petName={petName} />}
              {activeTab==='pomo' && <Pomodoro state={pomoState} controls={pomoControls} />}
              {activeTab==='todo' && <TodoList todos={todos} setTodos={setTodos} />}
              {activeTab==='settings' && <Settings />}
            </div>
          </ResizablePanel>
        </div>
      )}

      <Pet
        emotion={emotion}
        isLoading={isLoading}
        cpuUsage={cpuUsage}
        isPanelOpen={panelOpen}
        onTogglePanel={handleTogglePanel}
        speedMultiplier={petSpeed}
        weatherGreeting={weatherGreeting}
      />
    </div>
  )
}
