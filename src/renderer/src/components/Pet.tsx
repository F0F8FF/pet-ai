import { useEffect, useRef, useState, useCallback } from 'react'
import { PetEmotion } from '../hooks/useGemini'
import spriteRaw from '../assets/pet-sprite.png'

interface PetProps {
  emotion: PetEmotion
  isLoading: boolean
  cpuUsage: number
  isPanelOpen: boolean
  onTogglePanel: () => void
  speedMultiplier?: number
  weatherGreeting?: string | null
}

// 스프라이트: 1024×1024, 6열 × 7행
const COLS = 8
const ROWS = 8
const FW = 1024 / COLS
const FH = 1024 / ROWS
const DW = 95
const DH = Math.round(DW * FH / FW)

const FRAMES: Record<PetEmotion, [number, number][]> = {
  idle:     [[0,0],[1,0],[2,0],[1,0]],
  happy:    [[0,1],[1,1],[2,1],[3,1],[4,1],[5,1]],
  thinking: [[0,2],[1,2],[2,2],[1,2]],
  sleepy:   [[0,3],[1,3],[2,3],[1,3]],
  excited:  [[0,4],[1,4],[2,4],[3,4],[4,4],[5,4]],
  love:     [[0,5],[1,5],[2,5],[3,5],[4,5],[5,5]],
  hot:      [[0,6],[1,6],[2,6],[3,6],[4,6],[5,6]],
}

const FPS: Record<PetEmotion, number> = {
  idle: 700, happy: 180, thinking: 500,
  sleepy: 1000, excited: 130, love: 220, hot: 110,
}

const OVERLAYS: Partial<Record<PetEmotion, string>> = {
  thinking: '🤔', sleepy: '💤', excited: '✨', love: '💕', hot: '🔥',
}

const PET_W = DW
const PET_H = DH + 20
const MARGIN = 70
const IDLE_MSGS = ['주인님~ 👋', '뭐해요?', '심심해요 ㅠ', '놀아줘요~', '저 여기있어요!']

// 캔버스에 프레임 그리기 + 배경 자동 감지 후 Flood Fill 제거
function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  col: number, row: number
) {
  ctx.clearRect(0, 0, DW, DH)
  ctx.drawImage(img, col * FW, row * FH, FW, FH, 0, 0, DW, DH)

  try {
    const id = ctx.getImageData(0, 0, DW, DH)
    const d = id.data
    if (d[3] === 0) return // 이미 투명

    // 코너 4곳의 색을 샘플링해 배경색 자동 감지
    const corners = [0, (DW-1)*4, (DH-1)*DW*4, ((DH-1)*DW+(DW-1))*4]
    let bgR = 0, bgG = 0, bgB = 0, cnt = 0
    for (const ci of corners) {
      if (d[ci+3] > 0) { bgR += d[ci]; bgG += d[ci+1]; bgB += d[ci+2]; cnt++ }
    }
    if (cnt === 0) return
    bgR = Math.round(bgR/cnt); bgG = Math.round(bgG/cnt); bgB = Math.round(bgB/cnt)

    const TOL = 35 // 색상 허용 오차
    const W = DW, H = DH
    const visited = new Uint8Array(W * H)
    const isBg = (i: number) =>
      Math.abs(d[i*4]-bgR) < TOL &&
      Math.abs(d[i*4+1]-bgG) < TOL &&
      Math.abs(d[i*4+2]-bgB) < TOL

    const stack: number[] = []
    for (let x = 0; x < W; x++) { stack.push(x); stack.push((H-1)*W+x) }
    for (let y = 1; y < H-1; y++) { stack.push(y*W); stack.push(y*W+(W-1)) }

    while (stack.length > 0) {
      const p = stack.pop()!
      if (visited[p] || !isBg(p)) continue
      visited[p] = 1; d[p*4+3] = 0
      const x = p%W, y = Math.floor(p/W)
      if (x>0) stack.push(p-1); if (x<W-1) stack.push(p+1)
      if (y>0) stack.push(p-W); if (y<H-1) stack.push(p+W)
    }
    ctx.putImageData(id, 0, 0)
  } catch { /* cross-origin 오류 시 원본 유지 */ }
}

export type { PetEmotion }

export function Pet({ emotion, isLoading, cpuUsage, isPanelOpen, onTogglePanel, speedMultiplier = 1, weatherGreeting }: PetProps) {
  const initPos = useRef({ x: window.innerWidth - PET_W - 30, y: window.innerHeight - PET_H - 30 })
  const [pos, setPos] = useState(initPos.current)
  const posRef = useRef(initPos.current)
  const [moveDuration, setMoveDuration] = useState(0)
  const [isWalking, setIsWalking] = useState(false)
  const [facing, setFacing] = useState<'left' | 'right'>('right')
  const [frameIdx, setFrameIdx] = useState(0)
  const [idleMsg, setIdleMsg] = useState<string | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [screenSize, setScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const spriteImgRef = useRef<HTMLImageElement | null>(null)
  const hoverRef = useRef(false)
  const wanderTimer = useRef<ReturnType<typeof setTimeout>>()
  const walkTimer = useRef<ReturnType<typeof setTimeout>>()
  const isDragging = useRef(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const wasDragged = useRef(false)
  const lastClickRef = useRef(0)

  const activeEmotion: PetEmotion = cpuUsage > 85 ? 'hot' : emotion
  const curEmotion: PetEmotion = isLoading ? 'thinking' : isWalking ? 'happy' : activeEmotion
  const frames = FRAMES[curEmotion]

  // 스프라이트 이미지 로드 (crossOrigin 설정 → getImageData 허용)
  const [spriteReady, setSpriteReady] = useState(false)
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { spriteImgRef.current = img; setSpriteReady(true) }
    img.src = spriteRaw
    window.electronAPI.getScreenSize().then(setScreenSize)
    setMoveDuration(3000)
  }, [])

  // 프레임 순환
  useEffect(() => {
    setFrameIdx(0)
    const t = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), isWalking ? 140 : FPS[curEmotion])
    return () => clearInterval(t)
  }, [curEmotion, isWalking, frames.length])

  // 캔버스에 현재 프레임 그리기
  useEffect(() => {
    const canvas = canvasRef.current
    const img = spriteImgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    const [col, row] = frames[Math.min(frameIdx, frames.length - 1)]
    drawFrame(ctx, img, col, row)
  }, [frameIdx, frames, curEmotion])

  const moveTo = useCallback((x: number, y: number) => {
    const { x: ox, y: oy } = posRef.current
    const dur = Math.max(800, (Math.sqrt((x-ox)**2+(y-oy)**2)/160)*1000)
    setFacing(x>=ox?'right':'left'); setMoveDuration(dur)
    setIsWalking(true); setPos({x,y}); posRef.current={x,y}
    if (walkTimer.current) clearTimeout(walkTimer.current)
    walkTimer.current = setTimeout(()=>setIsWalking(false), dur)
  }, [])

  const scheduleWander = useCallback(() => {
    if (wanderTimer.current) clearTimeout(wanderTimer.current)
    wanderTimer.current = setTimeout(()=>{
      if (hoverRef.current||isPanelOpen||isPinned||isDragging.current){scheduleWander();return}
      if (Date.now() - lastClickRef.current < 1200) { scheduleWander(); return }
      const {width,height}=screenSize
      moveTo(MARGIN+Math.random()*(width-PET_W-MARGIN*2), MARGIN+Math.random()*(height-PET_H-MARGIN*2))
      scheduleWander()
    }, (isPanelOpen||isPinned)?30000:(8000+Math.random()*12000)/speedMultiplier)
  }, [isPanelOpen,isPinned,screenSize,moveTo,speedMultiplier])

  useEffect(()=>{
    scheduleWander()
    return ()=>{if(wanderTimer.current)clearTimeout(wanderTimer.current)}
  }, [scheduleWander])

  useEffect(()=>{
    if(emotion!=='idle'||isPanelOpen)return
    const t=setTimeout(()=>{
      setIdleMsg(IDLE_MSGS[Math.floor(Math.random()*IDLE_MSGS.length)])
      setTimeout(()=>setIdleMsg(null),2500)
    }, 6000+Math.random()*12000)
    return ()=>clearTimeout(t)
  }, [emotion,isPanelOpen,pos])

  const handleMouseDown = useCallback((e: React.MouseEvent)=>{
    if(e.button!==0)return; e.stopPropagation()
    const rect = wrapperRef.current?.getBoundingClientRect()
    const px = rect ? rect.left : posRef.current.x
    const py = rect ? rect.top : posRef.current.y
    posRef.current = { x: px, y: py }
    setPos({ x: px, y: py })
    isDragging.current=true; wasDragged.current=false
    dragStart.current={mx:e.clientX,my:e.clientY,px,py}
    setMoveDuration(0)
    const onMove=(me:MouseEvent)=>{
      const dx=me.clientX-dragStart.current.mx, dy=me.clientY-dragStart.current.my
      if(Math.abs(dx)>3||Math.abs(dy)>3)wasDragged.current=true
      const nx=Math.max(0,Math.min(screenSize.width-PET_W,dragStart.current.px+dx))
      const ny=Math.max(0,Math.min(screenSize.height-PET_H,dragStart.current.py+dy))
      setPos({x:nx,y:ny}); posRef.current={x:nx,y:ny}
    }
    const onUp=()=>{isDragging.current=false;setMoveDuration(3000);window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp)}
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
  }, [screenSize])

  return (
    <div
      ref={wrapperRef}
      className="pet-wrapper"
      style={{left:pos.x,top:pos.y,transition:moveDuration===0?'none':`left ${moveDuration}ms linear, top ${moveDuration}ms linear, transform 0.25s ease`}}
      onMouseEnter={()=>{hoverRef.current=true;setIsHovered(true);window.electronAPI.setIgnoreMouseEvents(false)}}
      onMouseLeave={()=>{hoverRef.current=false;setIsHovered(false);if(!isPanelOpen)window.electronAPI.setIgnoreMouseEvents(true)}}
    >
      {(weatherGreeting || idleMsg)&&!isPanelOpen&&(
        <div className="bubble-wrap">
          <div className="idle-bubble">{weatherGreeting ?? idleMsg}</div>
        </div>
      )}
      {cpuUsage>85&&(
        <div className="bubble-wrap">
          <div className="cpu-bubble">CPU {cpuUsage}% 🔥</div>
        </div>
      )}
      {(isHovered||isPinned)&&(
        <button className={`pin-btn ${isPinned?'pinned':''}`} onClick={e=>{e.stopPropagation();setIsPinned(p=>!p)}}>
          {isPinned?'📌':'📍'}
        </button>
      )}

      <div
        className="pet-canvas-wrap"
        style={{
          width: DW,
          height: DH,
          transform: `scaleX(${facing === 'left' ? -1 : 1})`,
          opacity: spriteReady ? 1 : 0,
        }}
      >
        <canvas
        ref={canvasRef}
        width={DW}
        height={DH}
        className={`pet-sprite anim-${curEmotion}`}
        style={{
          display:'block',
          cursor:isDragging.current?'grabbing':'grab',
        }}
        onMouseDown={handleMouseDown}
        onClick={()=>{if(!wasDragged.current){lastClickRef.current=Date.now();onTogglePanel()}}}
        />
      </div>

      {OVERLAYS[activeEmotion]&&(
        <div className="pet-emotion-overlay">{OVERLAYS[activeEmotion]}</div>
      )}
      {isPinned&&<div className="pinned-indicator">고정됨</div>}
    </div>
  )
}
