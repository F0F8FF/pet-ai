import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * 펫의 이동, 자세, 걸음 프레임, 몸짓, 눈 깜빡임을 계산하는 훅.
 *
 * 설계에서 중요한 네 가지:
 *
 *  1. 걸음 프레임은 시간이 아니라 "이동한 거리"로 넘긴다.
 *     시간으로 돌리면 실제 속도와 무관하게 다리가 움직여서 디딘 발이 미끄러진다.
 *     거리로 묶으면 이징 때문에 느려지는 출발·도착에서 다리도 같이 느려진다.
 *
 *  2. 반대로 꼬리 흔들기는 시간으로 돌린다. 앉아 있을 때는 이동 거리가 0 이라
 *     거리로 묶으면 꼬리가 멈춰버린다.
 *
 *  3. 위치와 프레임을 React state 로 두지 않고 DOM 에 직접 쓴다.
 *     매 프레임 setState 하면 60fps 로 리렌더가 돌아서 항상 켜져 있는 앱에 부담이 크다.
 *     리렌더는 걷기 시작/끝 같은 이산적인 변화에만 쓴다.
 *
 *  4. 몸짓(도약·스쿼시)은 약하게 준다. 다리 움직임은 스프라이트가 이미 표현하므로
 *     몸통까지 크게 흔들면 과장돼 보인다.
 */

// 이 거리(px)를 갈 때마다 걷기 프레임이 한 장 넘어간다.
const FRAME_STRIDE_PX = 11

// 꼬리 한 번 움직이는 시간(ms)
const WAG_MS = 130

// 도약 높이(px). 프레임이 다리를 그려주므로 보조 역할만 한다.
const BOB_PX = 3
// 발이 바닥에 닿는 순간 눌리는 비율
const GAIT_SQUASH = 0.04

// 속도 1px/s 당 기울어지는 각도. 네발짐승은 많이 기울면 이상해서 작게 잡는다.
const LEAN_PER_PX_S = 0.012
const MAX_LEAN_DEG = 3

// 가만히 있을 때 숨쉬기
const BREATH_MS = 2600
const BREATH_AMP = 0.022

// 착지·앉기 직후 반동이 잦아드는 시간
const SETTLE_MS = 420
const SETTLE_AMP = 0.09

// 들려 있을 때 몸이 늘어나는 비율
const DRAG_STRETCH = 0.04

// 이동 속도와 최소 이동 시간
const SPEED_PX_S = 160
const MIN_TRIP_MS = 800

// 들어 올렸다 놓았을 때 떨어지는 속도. 걷기보다 훨씬 빨라야 낙하로 읽힌다.
const FALL_SPEED_PX_S = 520
const MIN_FALL_MS = 220
// 떨어지는 동안 몸이 늘어나는 비율
const FALL_STRETCH = 0.06

// 눈 깜빡임: 지속 시간과 다음 깜빡임까지의 간격 범위
const BLINK_MS = 130
const BLINK_GAP_MIN_MS = 2200
const BLINK_GAP_MAX_MS = 6500

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** 낙하용. 중력처럼 갈수록 빨라진다. */
function easeInQuad(t: number): number {
  return t * t
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

interface Point {
  x: number
  y: number
}

/** 걷지 않을 때 취하는 자세. */
export type RestPose = 'stand' | 'sit'

export interface SpriteSheet {
  /** 가로 한 줄에 모든 자세의 프레임이 나열된 시트. */
  sheet: string
  /** 눈 감은 같은 배치의 시트. 없으면 깜빡이지 않는다. */
  blinkSheet?: string
  frameWidth: number
  frameHeight: number
  frameCount: number
  /** 정수배만 쓴다. 소수배로 확대하면 픽셀 블록이 뭉개진다. */
  scale: number
  poses: {
    /** 이동 거리로 순환한다. */
    walk: number[]
    /** 다리를 곧게 펴고 서 있는 한 장. */
    stand: number
    /** 시간으로 순환한다. 되돌아오도록 나열하면 꼬리가 자연스럽게 왕복한다. */
    sit: number[]
  }
  /**
   * 앉은 자세가 정면을 바라보는 그림인지. 정면 그림은 좌우를 뒤집으면
   * 의미가 없고 목걸이나 귀의 좌우가 어긋나므로 반전을 건너뛴다.
   */
  sitFacesViewer?: boolean
}

export function usePetMotion(
  initial: Point,
  sprite: SpriteSheet,
  initialRest: RestPose = 'stand',
) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const motionRef = useRef<HTMLDivElement>(null)
  const spriteRef = useRef<HTMLDivElement>(null)

  const [isWalking, setIsWalking] = useState(false)

  const pos = useRef<Point>({ ...initial })
  const prev = useRef<Point>({ ...initial })
  const from = useRef<Point>({ ...initial })
  const to = useRef<Point>({ ...initial })

  const startedAt = useRef(0)
  const duration = useRef(0)
  const moving = useRef(false)
  const settledAt = useRef(-Infinity)

  const phase = useRef(0)
  const facing = useRef<1 | -1>(1)
  const dragging = useRef(false)
  const restPose = useRef<RestPose>(initialRest)
  const falling = useRef(false)
  const ease = useRef(easeInOutCubic)

  const blinkUntil = useRef(0)
  const nextBlink = useRef(0)
  const shownSheet = useRef('')
  const shownFrame = useRef(-1)

  // 상수처럼 쓰지만 props 로 들어오므로 최신 값을 ref 로 들고 있는다.
  const cfg = useRef(sprite)
  cfg.current = sprite

  /** 목표 지점까지 이징을 걸어 걸어간다. 걷기 시작하면 앉은 자세는 풀린다. */
  const moveTo = useCallback((x: number, y: number) => {
    const dist = Math.hypot(x - pos.current.x, y - pos.current.y)
    if (dist < 1) return

    from.current = { ...pos.current }
    to.current = { x, y }
    duration.current = Math.max(MIN_TRIP_MS, (dist / SPEED_PX_S) * 1000)
    startedAt.current = performance.now()
    moving.current = true
    falling.current = false
    ease.current = easeInOutCubic
    restPose.current = 'stand'
    facing.current = x >= pos.current.x ? 1 : -1
    setIsWalking(true)
  }, [])

  /**
   * 지정한 곳으로 떨어뜨린다. 들어 올렸다 놓았을 때 쓴다.
   *
   * moveTo 로 바닥까지 걸어가게 하면 공중에서 다리를 움직여 이상하다. 그래서
   * 낙하는 걷기 프레임을 쓰지 않고, 가속하는 이징으로 훨씬 빠르게 내려온다.
   */
  const drop = useCallback((x: number, y: number) => {
    const dist = Math.hypot(x - pos.current.x, y - pos.current.y)
    if (dist < 1) return

    from.current = { ...pos.current }
    to.current = { x, y }
    duration.current = Math.max(MIN_FALL_MS, (dist / FALL_SPEED_PX_S) * 1000)
    startedAt.current = performance.now()
    moving.current = true
    falling.current = true
    ease.current = easeInQuad
    restPose.current = 'stand' // 떨어진 뒤에는 네 발로 착지한다
    setIsWalking(false)
  }, [])

  /** 이징 없이 즉시 옮긴다. 드래그용. */
  const placeAt = useCallback((x: number, y: number) => {
    pos.current = { x, y }
    from.current = { x, y }
    to.current = { x, y }
    moving.current = false
    setIsWalking(false)
  }, [])

  /** 걷기를 멈추고 자세를 바꾼다. 앉을 때는 몸을 살짝 눌러 앉는 느낌을 준다. */
  const rest = useCallback((pose: RestPose) => {
    if (restPose.current === pose) return
    restPose.current = pose
    moving.current = false
    settledAt.current = performance.now()
    setIsWalking(false)
  }, [])

  const setDragging = useCallback((value: boolean) => {
    dragging.current = value
    if (value) moving.current = false
  }, [])

  const position = useCallback(() => ({ ...pos.current }), [])

  // 위치는 React 가 아니라 이 훅이 소유한다. 첫 페인트 전에 한 번 심어두지 않으면
  // 리렌더가 일어날 때마다 React 가 left/top 을 초기값으로 되돌려 한 프레임씩 튄다.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    wrapper.style.left = `${pos.current.x}px`
    wrapper.style.top = `${pos.current.y}px`
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)

      const dt = Math.max(1, now - last)
      last = now

      if (moving.current) {
        const t = clamp((now - startedAt.current) / duration.current, 0, 1)
        const e = ease.current(t)
        pos.current = {
          x: from.current.x + (to.current.x - from.current.x) * e,
          y: from.current.y + (to.current.y - from.current.y) * e,
        }
        if (t >= 1) {
          moving.current = false
          falling.current = false
          settledAt.current = now
          setIsWalking(false)
        }
      }

      const dx = pos.current.x - prev.current.x
      const dy = pos.current.y - prev.current.y
      const travelled = Math.hypot(dx, dy)
      const vx = (dx / dt) * 1000
      prev.current = { ...pos.current }

      // 프레임을 거리로 넘기는 것이 발 미끄러짐을 막는 핵심이다.
      phase.current += travelled / FRAME_STRIDE_PX

      const wrapper = wrapperRef.current
      if (wrapper) {
        wrapper.style.left = `${Math.round(pos.current.x)}px`
        wrapper.style.top = `${Math.round(pos.current.y)}px`
      }

      // 떨어지는 중에는 걷는 것으로 보지 않는다. 그래야 공중에서 다리를 젓지 않는다.
      const airborne = falling.current && moving.current
      const stepping = !dragging.current && !airborne && (moving.current || travelled > 0.05)

      let ty = 0
      let rot = 0
      let sx = 1
      let sy = 1

      if (dragging.current) {
        // 들려 있는 동안은 튀지 않는다. 끄는 방향으로 기울고 살짝 늘어난다.
        rot = clamp(vx * LEAN_PER_PX_S * 3, -MAX_LEAN_DEG * 2, MAX_LEAN_DEG * 2)
        sy = 1 + DRAG_STRETCH
        sx = 1 - DRAG_STRETCH * 0.6
      } else if (airborne) {
        sy = 1 + FALL_STRETCH
        sx = 1 - FALL_STRETCH * 0.6
      } else if (stepping) {
        // 프레임 두 장마다 한 번 오르내려서 걸음과 위상이 맞는다.
        const hop = Math.abs(Math.sin(phase.current * Math.PI * 0.5))
        ty = -hop * BOB_PX
        sy = 1 - (1 - hop) * GAIT_SQUASH
        sx = 1 + (1 - hop) * GAIT_SQUASH * 0.6
        rot = clamp(vx * LEAN_PER_PX_S, -MAX_LEAN_DEG, MAX_LEAN_DEG)
      } else {
        const breath = Math.sin((now / BREATH_MS) * Math.PI * 2)
        sy = 1 + breath * BREATH_AMP
        sx = 1 - breath * BREATH_AMP * 0.6

        // 멈춘 직후, 그리고 앉는 순간에 반동을 준다.
        const since = now - settledAt.current
        if (since < SETTLE_MS) {
          const decay = 1 - since / SETTLE_MS
          const wobble = Math.cos((since / SETTLE_MS) * Math.PI * 3) * decay * SETTLE_AMP
          sy *= 1 - wobble
          sx *= 1 + wobble * 0.6
        }
      }

      const motion = motionRef.current
      if (motion) {
        motion.style.transform = `translateY(${ty.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
      }

      if (now >= nextBlink.current) {
        blinkUntil.current = now + BLINK_MS
        nextBlink.current =
          now + BLINK_MS + BLINK_GAP_MIN_MS + Math.random() * (BLINK_GAP_MAX_MS - BLINK_GAP_MIN_MS)
      }

      const el = spriteRef.current
      if (el) {
        const { sheet, blinkSheet, frameWidth, scale, poses, sitFacesViewer } = cfg.current
        const sitting = !stepping && !airborne && restPose.current === 'sit'

        let index: number
        if (stepping) {
          index = poses.walk[Math.floor(phase.current) % poses.walk.length]
        } else if (sitting) {
          index = poses.sit[Math.floor(now / WAG_MS) % poses.sit.length]
        } else {
          index = poses.stand
        }

        if (index !== shownFrame.current) {
          el.style.backgroundPositionX = `${-index * frameWidth * scale}px`
          shownFrame.current = index
        }

        const wanted = blinkSheet && now < blinkUntil.current ? blinkSheet : sheet
        if (wanted !== shownSheet.current) {
          el.style.backgroundImage = `url(${wanted})`
          shownSheet.current = wanted
        }

        el.style.transform = `scaleX(${sitting && sitFacesViewer ? 1 : facing.current})`
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return {
    wrapperRef, motionRef, spriteRef,
    isWalking, moveTo, drop, placeAt, rest, setDragging, position,
  }
}
