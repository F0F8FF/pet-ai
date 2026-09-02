import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { PetEmotion } from '../hooks/useGemini'
import { usePetMotion, RestPose } from '../hooks/usePetMotion'
import dogSheet from '../assets/pet/dog.png'
import dogBlinkSheet from '../assets/pet/dog-blink.png'

interface PetProps {
  emotion: PetEmotion
  isLoading: boolean
  cpuUsage: number
  isPanelOpen: boolean
  onTogglePanel: () => void
  speedMultiplier?: number
  weatherGreeting?: string | null
}

// dog.png 는 64×56 프레임 8장이 가로로 나열된 시트다.
// 0~3 걷기 / 4 서기 / 5~7 앉기(꼬리 낮음·중간·높음).
// dog-blink.png 는 같은 배치이고 눈 픽셀만 다르다.
const FRAME_W = 64
const FRAME_H = 56
const FRAME_COUNT = 8
// 픽셀 아트는 정수배로만 확대한다. 소수배는 블록을 뭉갠다.
const SCALE = 2

const POSES = {
  walk: [0, 1, 2, 3],
  stand: 4,
  // 5→6→7→6 으로 돌면 꼬리가 한쪽으로 튀지 않고 왕복한다.
  sit: [5, 6, 7, 6],
}

// 앱을 켰을 때의 자세. 앉아서 주인을 쳐다보는 모습으로 시작한다.
const INITIAL_REST: RestPose = 'sit'
// 첫 페인트에 쓸 프레임. 서 있는 프레임으로 두면 훅이 보정하기 전 한 장이 스친다.
const INITIAL_FRAME = INITIAL_REST === 'sit' ? POSES.sit[0] : POSES.stand

const DW = FRAME_W * SCALE
const DH = FRAME_H * SCALE

const PET_W = DW
const PET_H = DH + 20
const MARGIN = 70

// 강아지는 화면 아래를 바닥처럼 쓴다. 화면 전체를 돌아다니면 붕 떠 보인다.
const FLOOR_GAP = 24
const floorY = (screenHeight: number) => screenHeight - PET_H - FLOOR_GAP

// 앉아 있는 시간과 다음 행동을 고민하는 간격
const SIT_MIN_MS = 2500
const SIT_EXTRA_MS = 2500
const THINK_MIN_MS = 6000
const THINK_EXTRA_MS = 10000
// 걷는 대신 앉을 확률. 늘 걸어다니기만 하면 기계처럼 보인다.
const SIT_CHANCE = 0.35

// 절차적 몸짓이 다루지 못하는 감정만 CSS 키프레임에 맡긴다.
const CSS_ANIM: Partial<Record<PetEmotion, string>> = {
  thinking: 'anim-thinking',
  sleepy: 'anim-sleepy',
  excited: 'anim-excited',
  love: 'anim-love',
  hot: 'anim-hot',
}

const OVERLAYS: Partial<Record<PetEmotion, string>> = {
  thinking: '🤔', sleepy: '💤', excited: '✨', love: '💕', hot: '🔥',
}

const IDLE_MSGS = ['주인님~ 👋', '뭐해요?', '심심해요 ㅠ', '놀아줘요~', '저 여기있어요!']

export type { PetEmotion }

export function Pet({ emotion, isLoading, cpuUsage, isPanelOpen, onTogglePanel, speedMultiplier = 1, weatherGreeting }: PetProps) {
  const initPos = useRef({ x: window.innerWidth - PET_W - 30, y: floorY(window.innerHeight) })

  const spriteConfig = useMemo(
    () => ({
      sheet: dogSheet,
      blinkSheet: dogBlinkSheet,
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
      frameCount: FRAME_COUNT,
      scale: SCALE,
      poses: POSES,
      sitFacesViewer: true,
    }),
    [],
  )

  const {
    wrapperRef, motionRef, spriteRef,
    isWalking, moveTo, drop, placeAt, rest, setDragging, position,
  } = usePetMotion(initPos.current, spriteConfig, INITIAL_REST)

  const [idleMsg, setIdleMsg] = useState<string | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [screenSize, setScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  const hoverRef = useRef(false)
  const behaviourTimer = useRef<ReturnType<typeof setTimeout>>()
  const sitTimer = useRef<ReturnType<typeof setTimeout>>()
  const isDragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const wasDragged = useRef(false)
  const lastClickRef = useRef(0)

  const activeEmotion: PetEmotion = cpuUsage > 85 ? 'hot' : emotion
  const curEmotion: PetEmotion = isLoading ? 'thinking' : isWalking ? 'happy' : activeEmotion

  useEffect(() => {
    window.electronAPI.getScreenSize().then(setScreenSize)
  }, [])

  // 걷기와 앉기를 확률로 번갈아 고른다. 목적지로만 걸어다니면 살아 있는 느낌이 없다.
  const scheduleBehaviour = useCallback(() => {
    if (behaviourTimer.current) clearTimeout(behaviourTimer.current)

    behaviourTimer.current = setTimeout(() => {
      const busy = hoverRef.current || isDragging.current || isPinned || isPanelOpen
      const justClicked = Date.now() - lastClickRef.current < 1200

      if (!busy && !justClicked) {
        if (Math.random() < SIT_CHANCE) {
          rest('sit')
          if (sitTimer.current) clearTimeout(sitTimer.current)
          sitTimer.current = setTimeout(
            () => rest('stand'),
            SIT_MIN_MS + Math.random() * SIT_EXTRA_MS,
          )
        } else {
          // 가로로만 돌아다닌다. 목적지 높이는 항상 바닥이다.
          const { width, height } = screenSize
          moveTo(MARGIN + Math.random() * (width - PET_W - MARGIN * 2), floorY(height))
        }
      }

      scheduleBehaviour()
    }, (THINK_MIN_MS + Math.random() * THINK_EXTRA_MS) / speedMultiplier)
  }, [isPanelOpen, isPinned, screenSize, moveTo, rest, speedMultiplier])

  useEffect(() => {
    scheduleBehaviour()
    return () => {
      if (behaviourTimer.current) clearTimeout(behaviourTimer.current)
      if (sitTimer.current) clearTimeout(sitTimer.current)
    }
  }, [scheduleBehaviour])

  // 말을 걸면 앉아서 듣고, 대화를 닫으면 일어난다.
  const wasPanelOpen = useRef(false)
  useEffect(() => {
    if (isPanelOpen) {
      if (sitTimer.current) clearTimeout(sitTimer.current)
      rest('sit')
    } else if (wasPanelOpen.current) {
      // 닫힌 "순간" 에만 일어난다. 조건 없이 두면 첫 렌더에서 시작 자세를 덮어쓴다.
      rest('stand')
    }
    wasPanelOpen.current = isPanelOpen
  }, [isPanelOpen, rest])

  useEffect(() => {
    if (emotion !== 'idle' || isPanelOpen) return
    const t = setTimeout(() => {
      setIdleMsg(IDLE_MSGS[Math.floor(Math.random() * IDLE_MSGS.length)])
      setTimeout(() => setIdleMsg(null), 2500)
    }, 6000 + Math.random() * 12000)
    return () => clearTimeout(t)
  }, [emotion, isPanelOpen, isWalking])

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
        Math.max(0, Math.min(screenSize.width - PET_W, dragStart.current.px + dx)),
        Math.max(0, Math.min(screenSize.height - PET_H, dragStart.current.py + dy)),
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
  }, [screenSize, placeAt, position, setDragging, drop])

  return (
    <div
      ref={wrapperRef}
      className="pet-wrapper"
      onMouseEnter={() => { hoverRef.current = true; setIsHovered(true); window.electronAPI.setIgnoreMouseEvents(false) }}
      onMouseLeave={() => { hoverRef.current = false; setIsHovered(false); if (!isPanelOpen) window.electronAPI.setIgnoreMouseEvents(true) }}
    >
      {(weatherGreeting || idleMsg) && !isPanelOpen && (
        <div className="bubble-wrap">
          <div className="idle-bubble">{weatherGreeting ?? idleMsg}</div>
        </div>
      )}
      {cpuUsage > 85 && (
        <div className="bubble-wrap">
          <div className="cpu-bubble">CPU {cpuUsage}% 🔥</div>
        </div>
      )}
      {(isHovered || isPinned) && (
        <button className={`pin-btn ${isPinned ? 'pinned' : ''}`} onClick={e => { e.stopPropagation(); setIsPinned(p => !p) }}>
          {isPinned ? '📌' : '📍'}
        </button>
      )}

      {/* 감정 레이어: CSS 키프레임 */}
      <div className={`pet-canvas-wrap pet-sprite ${CSS_ANIM[curEmotion] ?? ''}`} style={{ width: DW, height: DH }}>
        {/* 몸짓 레이어: 훅이 매 프레임 transform 을 씀 */}
        <div ref={motionRef} className="pet-motion">
          {/* 스프라이트 레이어: 훅이 background-position 으로 프레임을 넘김 */}
          <div
            ref={spriteRef}
            className="pet-sprite-frame"
            style={{
              width: DW,
              height: DH,
              backgroundImage: `url(${dogSheet})`,
              backgroundSize: `${FRAME_W * FRAME_COUNT * SCALE}px ${DH}px`,
              backgroundPositionX: `${-INITIAL_FRAME * DW}px`,
            }}
            onMouseDown={handleMouseDown}
            onClick={() => { if (!wasDragged.current) { lastClickRef.current = Date.now(); onTogglePanel() } }}
          />
        </div>
      </div>

      {OVERLAYS[activeEmotion] && (
        <div className="pet-emotion-overlay">{OVERLAYS[activeEmotion]}</div>
      )}
      {isPinned && <div className="pinned-indicator">고정됨</div>}
    </div>
  )
}
