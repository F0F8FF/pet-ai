import { useEffect, useRef, useState, useCallback, CSSProperties } from 'react'
import { PetEmotion } from '../hooks/useGemini'
import { usePetMotion } from '../hooks/usePetMotion'
import { Character, ClipName, GAZE_DIRS, displayScale } from '../pet/character'

interface PetProps {
  character: Character
  /** 크기 배율 (1 = 보통) */
  size: number
  petName: string
  emotion: PetEmotion
  isLoading: boolean
  cpuUsage: number
  isPanelOpen: boolean
  onTogglePanel: () => void
  /** 머리 위 입력창에서 보낸 말 */
  onTalk: (text: string) => void
  /** 입력창 위에 띄울 빠른 질문 */
  chips: string[]
  /** 펫이 방금 한 말. 패널이 닫혀 있으면 머리 위 말풍선으로 보여준다. */
  speech: { text: string; at: number } | null
  /** 값이 바뀔 때마다 입력창을 연다 (우클릭 메뉴의 "말 걸기") */
  talkSignal: number
  /** 값이 바뀔 때마다 춤춘다 */
  danceSignal: number
  /** true 면 한 번 클릭이 말 걸기, 두 번 클릭이 패널 */
  clickTalk: boolean
  /** 뽀모도로가 도는 동안 머리 위에 띄울 글. working 이면 공부하는 자세를 한다. */
  focus: { text: string; working: boolean } | null
  /** 버튼이 달린 말풍선 (예: 어제 남은 할 일을 오늘도 할지) */
  prompt: PetPrompt | null
  onPrompt: (value: string) => void
  speedMultiplier?: number
  weatherGreeting?: string | null
}

export interface PetPrompt {
  text: string
  actions: { label: string; value: string }[]
}

const MARGIN = 70

// 화면 아래를 바닥처럼 쓴다. 화면 전체를 돌아다니면 붕 떠 보인다.
const FLOOR_GAP = 24
const BOX_PAD = 20

// 쉬는 시간과 다음 행동을 고민하는 간격
const SIT_MIN_MS = 2500
const SIT_EXTRA_MS = 2500
const THINK_MIN_MS = 6000
const THINK_EXTRA_MS = 10000
// 걷는 대신 제자리 동작을 할 확률. 늘 걸어다니기만 하면 기계처럼 보인다.
const IDLE_ACTION_CHANCE = 0.4
// 두리번은 넣지 않는다. 고개는 커서를 따라갈 때만 돌린다.
const IDLE_ACTIONS: ClipName[] = ['idleAlt', 'wait']

// 마우스가 이만큼 오래 안 움직이면 존다
const DOZE_AFTER_MS = 3 * 60_000
// 커서가 이 거리 안에 있으면 그쪽으로 고개를 돌린다
const GAZE_RADIUS_PX = 500
// 펫 위에서 좌우로 이만큼 왕복하면 쓰다듬은 것으로 본다
const STROKES_TO_PET = 4
const STROKE_WINDOW_MS = 1200
// 두 번째 클릭을 기다리는 시간. 이 안에 또 누르면 패널 대신 입력창을 연다.
const DOUBLE_CLICK_MS = 240

const LINE_MS = 3000
const SPEECH_MS = 7000

/** 감정이 바뀌는 순간 한 번 하는 동작과 반복 횟수 */
const EMOTION_CLIP: Partial<Record<PetEmotion, [ClipName, number]>> = {
  happy: ['wave', 1],
  excited: ['jump', 2],
  love: ['jump', 1],
  sleepy: ['doze', 2],
  sad: ['sad', 1],
}

const OVERLAYS: Partial<Record<PetEmotion, string>> = { love: '💕', hot: '🔥', sleepy: '💤' }

const IDLE_MSGS = ['주인님~ 👋', '뭐해요?', '심심해요 ㅠ', '놀아줘요~', '저 여기있어요!']
const PETTED_MSGS = ['헤헤 간지러워요~', '더 쓰다듬어 줘요 💕', '기분 좋아요 ☺️']
const WAKE_MSGS = ['앗, 깜빡 졸았어요!', '주인님 왔다! 🐾', '흐암… 안 잤어요!']

const DANCE: Array<[ClipName, number]> = [['jump', 1], ['wave', 2], ['look', 1], ['jump', 2], ['wave', 1]]

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export type { PetEmotion }

export function Pet({
  character, size, petName, emotion, isLoading, cpuUsage, isPanelOpen, onTogglePanel,
  onTalk, chips, speech, talkSignal, danceSignal, clickTalk, focus, prompt, onPrompt,
  speedMultiplier = 1, weatherGreeting,
}: PetProps) {
  const scale = displayScale(character, size)
  const dw = character.frameW * scale
  const dh = character.frameH * scale
  const boxH = dh + BOX_PAD
  const floorY = useCallback((screenH: number) => screenH - boxH - FLOOR_GAP, [boxH])

  const initPos = useRef({ x: window.innerWidth - dw - 30, y: floorY(window.innerHeight) })
  const {
    wrapperRef, motionRef, spriteRef,
    isWalking, moveTo, drop, placeAt, rest, play, playSeq, face, lookAt, setDragging, position,
  } = usePetMotion(initPos.current, character, scale, character.clips.sit ? 'sit' : 'idle')

  const [idleMsg, setIdleMsg] = useState<string | null>(null)
  const [line, setLine] = useState<string | null>(null)
  const [shownSpeech, setShownSpeech] = useState<string | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [dozing, setDozing] = useState(false)
  const [talkOpen, setTalkOpen] = useState(false)
  const [talkText, setTalkText] = useState('')
  const [screenSize, setScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  const hoverRef = useRef(false)
  const behaviourTimer = useRef<ReturnType<typeof setTimeout>>()
  const sitTimer = useRef<ReturnType<typeof setTimeout>>()
  const lineTimer = useRef<ReturnType<typeof setTimeout>>()
  const clickTimer = useRef<ReturnType<typeof setTimeout>>()
  const isDragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const wasDragged = useRef(false)
  const lastClickRef = useRef(0)
  const lastActivity = useRef(Date.now())
  const stroke = useRef({ dir: 0, x: 0, count: 0, since: 0, cooldownUntil: 0 })

  const hot = cpuUsage > 85
  const activeEmotion: PetEmotion = hot ? 'hot' : emotion

  // 지금 상태에서 반복할 제자리 동작. 한 번짜리 동작이 끝나면 여기로 돌아온다.
  const studying = !!focus?.working
  const restPose: ClipName =
    isLoading || studying ? 'think'
    : dozing ? 'doze'
    : hot ? 'sad'
    : isPanelOpen || talkOpen ? 'sit'
    : 'idle'
  const restPoseRef = useRef(restPose)
  restPoseRef.current = restPose

  const say = useCallback((text: string, ms = LINE_MS) => {
    if (lineTimer.current) clearTimeout(lineTimer.current)
    setLine(text)
    lineTimer.current = setTimeout(() => setLine(null), ms)
  }, [])

  useEffect(() => {
    window.electronAPI.getScreenSize().then(setScreenSize)
  }, [])

  // 크기나 캐릭터가 바뀌면 바닥 높이도 바뀌므로 다시 내려놓는다.
  useEffect(() => {
    const { x } = position()
    placeAt(Math.max(0, Math.min(screenSize.width - dw, x)), floorY(screenSize.height))
  }, [dw, screenSize, floorY, placeAt, position])

  // 첫 렌더에는 시작 자세(앉기)를 그대로 두고, 상태가 바뀔 때만 따라간다.
  const firstRest = useRef(true)
  useEffect(() => {
    if (firstRest.current) { firstRest.current = false; return }
    if (sitTimer.current) clearTimeout(sitTimer.current)
    rest(restPose)
  }, [restPose, rest])

  useEffect(() => {
    const clip = EMOTION_CLIP[emotion]
    if (clip) play(clip[0], clip[1])
  }, [emotion, play])

  // 걷기와 제자리 동작을 확률로 번갈아 고른다. 목적지로만 걸어다니면 살아 있는 느낌이 없다.
  const scheduleBehaviour = useCallback(() => {
    if (behaviourTimer.current) clearTimeout(behaviourTimer.current)

    behaviourTimer.current = setTimeout(() => {
      const busy = hoverRef.current || isDragging.current || isPinned || isPanelOpen
        || talkOpen || dozing || isLoading || studying || !!prompt
      const justClicked = Date.now() - lastClickRef.current < 1200

      if (!busy && !justClicked) {
        if (Math.random() < IDLE_ACTION_CHANCE) {
          if (character.clips.sit) {
            rest('sit')
            if (sitTimer.current) clearTimeout(sitTimer.current)
            sitTimer.current = setTimeout(
              () => rest(restPoseRef.current),
              SIT_MIN_MS + Math.random() * SIT_EXTRA_MS,
            )
          } else {
            play(pick(IDLE_ACTIONS), 1 + Math.round(Math.random()))
          }
        } else {
          const { width, height } = screenSize
          moveTo(MARGIN + Math.random() * (width - dw - MARGIN * 2), floorY(height))
        }
      }

      scheduleBehaviour()
    }, (THINK_MIN_MS + Math.random() * THINK_EXTRA_MS) / speedMultiplier)
  }, [isPanelOpen, isPinned, talkOpen, dozing, isLoading, studying, prompt, character, screenSize, dw, floorY, moveTo, rest, play, speedMultiplier])

  useEffect(() => {
    scheduleBehaviour()
    return () => {
      if (behaviourTimer.current) clearTimeout(behaviourTimer.current)
      if (sitTimer.current) clearTimeout(sitTimer.current)
    }
  }, [scheduleBehaviour])

  // 창이 마우스를 통과시키는 동안에도 forward 옵션 덕에 움직임은 들어온다.
  // 이걸로 커서 쪽으로 고개를 돌리고, 오래 안 움직이면 졸게 한다.
  const dozingRef = useRef(dozing)
  dozingRef.current = dozing
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      lastActivity.current = Date.now()
      if (dozingRef.current) {
        setDozing(false)
        play('wave')
        say(pick(WAKE_MSGS))
        return
      }
      if (isDragging.current) return
      // 얼굴(위쪽 1/3) 기준으로 커서 방향을 잰다.
      const { x, y } = position()
      const dx = e.clientX - (x + dw / 2)
      const dy = e.clientY - (y + dh * 0.35)
      const dist = Math.hypot(dx, dy)
      if (dist > GAZE_RADIUS_PX || dist < dw * 0.4) {
        lookAt(null)
        return
      }
      if (!character.gaze) {
        face(dx > 0 ? 1 : -1)
        return
      }
      // 45°씩 8방향으로 나눈다.
      const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
      lookAt(GAZE_DIRS[(sector + 8) % 8])
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [character, dw, dh, position, face, lookAt, play, say])

  useEffect(() => {
    if (danceSignal) { setDozing(false); playSeq(DANCE) }
  }, [danceSignal, playSeq])

  useEffect(() => {
    const t = setInterval(() => {
      if (isPanelOpen || talkOpen || isLoading || studying) return
      if (Date.now() - lastActivity.current > DOZE_AFTER_MS) setDozing(true)
    }, 10_000)
    return () => clearInterval(t)
  }, [isPanelOpen, talkOpen, isLoading, studying])

  useEffect(() => {
    if (emotion !== 'idle' || isPanelOpen || dozing) return
    const t = setTimeout(() => {
      setIdleMsg(pick(IDLE_MSGS))
      setTimeout(() => setIdleMsg(null), 2500)
    }, 6000 + Math.random() * 12000)
    return () => clearTimeout(t)
  }, [emotion, isPanelOpen, isWalking, dozing])

  useEffect(() => {
    if (!speech) return
    setShownSpeech(speech.text)
    const t = setTimeout(() => setShownSpeech(null), SPEECH_MS)
    return () => clearTimeout(t)
  }, [speech])

  const openTalk = useCallback(() => {
    setTalkOpen(true)
    setDozing(false)
    play('wave')
  }, [play])

  useEffect(() => {
    if (talkSignal) openTalk()
  }, [talkSignal, openTalk])

  const sendTalk = (text: string) => {
    const t = text.trim()
    if (!t) return
    setTalkText('')
    setTalkOpen(false)
    onTalk(t)
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()

    const { x, y } = position()
    isDragging.current = true
    wasDragged.current = false
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, px: x, py: y }

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - dragStart.current.mx
      const dy = me.clientY - dragStart.current.my
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragged.current = true
      placeAt(
        Math.max(0, Math.min(screenSize.width - dw, dragStart.current.px + dx)),
        Math.max(0, Math.min(screenSize.height - boxH, dragStart.current.py + dy)),
      )
    }
    const onUp = () => {
      isDragging.current = false
      setDragging(false)

      // 바닥 위에 놓았으면 떨어뜨린다. 걸어 내려오게 하면 공중을 딛는다.
      const floor = floorY(screenSize.height)
      const { x, y } = position()
      if (y < floor - 2) drop(x, floor)

      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [screenSize, dw, boxH, floorY, placeAt, position, setDragging, drop])

  // 기본은 한 번 누르면 패널, 두 번 누르면 그 자리에서 말 걸기. 설정에서 반대로 바꿀 수 있다.
  const handleClick = (e: React.MouseEvent) => {
    if (wasDragged.current) return
    lastClickRef.current = Date.now()
    if (clickTimer.current) clearTimeout(clickTimer.current)
    const single = clickTalk ? openTalk : onTogglePanel
    const double = clickTalk ? onTogglePanel : openTalk
    if (e.detail >= 2) {
      double()
      return
    }
    clickTimer.current = setTimeout(single, DOUBLE_CLICK_MS)
  }

  const handleStroke = (e: React.MouseEvent) => {
    if (e.buttons !== 0 || talkOpen) return
    const s = stroke.current
    const now = Date.now()
    if (now < s.cooldownUntil) return
    const dir = Math.sign(e.clientX - s.x)
    s.x = e.clientX
    if (!dir || dir === s.dir) return
    if (now - s.since > STROKE_WINDOW_MS) { s.count = 0; s.since = now }
    s.dir = dir
    s.count++
    if (s.count >= STROKES_TO_PET) {
      s.count = 0
      s.cooldownUntil = now + 3000
      setDozing(false)
      play('jump')
      say(pick(PETTED_MSGS))
    }
  }

  const leave = () => {
    hoverRef.current = false
    setIsHovered(false)
    if (!isPanelOpen) window.electronAPI.setIgnoreMouseEvents(true)
  }

  // 집중 중에는 잡담(idleMsg) 대신 남은 시간을 띄워 둔다.
  const bubble = isLoading && !isPanelOpen
    ? '…'
    : !isPanelOpen ? (shownSpeech ?? line ?? weatherGreeting ?? focus?.text ?? idleMsg) : null

  // 화면 가장자리에 붙어 있으면 말풍선이 잘리지 않게 안쪽으로 붙인다.
  const { x: petX } = position()
  const edge = petX > screenSize.width - 220 ? 'edge-right' : petX < 120 ? 'edge-left' : ''
  const overlay = dozing ? '💤' : OVERLAYS[activeEmotion]

  return (
    <div
      ref={wrapperRef}
      className="pet-wrapper"
      style={{ '--pet-h': `${dh}px`, '--pet-w': `${dw}px` } as CSSProperties}
      onMouseEnter={() => { hoverRef.current = true; setIsHovered(true); window.electronAPI.setIgnoreMouseEvents(false) }}
      onMouseLeave={leave}
    >
      {talkOpen ? (
        <div className={`bubble-wrap talk-wrap ${edge}`}>
          <div className="talk-box" onMouseDown={(e) => e.stopPropagation()}>
            {chips.length > 0 && (
              <div className="talk-chips">
                {chips.map((c) => (
                  <button
                    key={c}
                    className="talk-chip"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => sendTalk(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <input
              className="talk-input"
              autoFocus
              value={talkText}
              placeholder={`${petName || '뭉이'}에게 말 걸기`}
              onChange={(e) => setTalkText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') sendTalk(talkText)
                if (e.key === 'Escape') setTalkOpen(false)
              }}
              onBlur={() => setTalkOpen(false)}
            />
          </div>
        </div>
      ) : prompt && !isPanelOpen ? (
        <div className={`bubble-wrap ${edge}`}>
          <div className="idle-bubble prompt-bubble" onMouseDown={(e) => e.stopPropagation()}>
            {prompt.text}
            <div className="talk-chips">
              {prompt.actions.map((a) => (
                <button key={a.value} className="talk-chip" onClick={() => onPrompt(a.value)}>{a.label}</button>
              ))}
            </div>
          </div>
        </div>
      ) : bubble && (
        <div className={`bubble-wrap ${edge}`}>
          <div className={`idle-bubble ${bubble === focus?.text ? 'focus-bubble' : ''}`}>{bubble}</div>
        </div>
      )}
      {hot && !talkOpen && (
        <div className="bubble-wrap">
          <div className="cpu-bubble">CPU {cpuUsage}% 🔥</div>
        </div>
      )}
      {(isHovered || isPinned) && !talkOpen && (
        <button className={`pin-btn ${isPinned ? 'pinned' : ''}`} onClick={e => { e.stopPropagation(); setIsPinned(p => !p) }}>
          {isPinned ? '📌' : '📍'}
        </button>
      )}

      <div className="pet-canvas-wrap" style={{ width: dw, height: dh }}>
        {/* 몸짓 레이어: 훅이 매 프레임 transform 을 씀 */}
        <div ref={motionRef} className="pet-motion">
          {/* 스프라이트 레이어: 훅이 background-position 으로 프레임을 넘김 */}
          <div
            ref={spriteRef}
            className="pet-sprite-frame"
            style={{
              width: dw,
              height: dh,
              backgroundImage: `url(${character.sheet})`,
              backgroundSize: `${character.cols * character.frameW * scale}px ${character.rows * character.frameH * scale}px`,
              imageRendering: character.pixelated ? 'pixelated' : 'auto',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleStroke}
            onClick={handleClick}
            onContextMenu={(e) => { e.preventDefault(); window.electronAPI.showPetMenu() }}
          />
        </div>
      </div>

      {overlay && <div className="pet-emotion-overlay">{overlay}</div>}
      {isPinned && <div className="pinned-indicator">고정됨</div>}
    </div>
  )
}
