import dogSheet from '../assets/pet/dog.png'
import dogBlinkSheet from '../assets/pet/dog-blink.png'

/** 펫이 할 수 있는 동작. 시트에 없는 동작은 CLIP_FALLBACK을 따라 비슷한 동작으로 대신한다. */
export type ClipName =
  | 'idle' | 'blink' | 'walkRight' | 'walkLeft' | 'sit'
  | 'wave' | 'jump' | 'sad' | 'doze' | 'wait' | 'think' | 'idleAlt' | 'look'

export interface Clip {
  row: number
  frames: number[]
  frameMs: number
  /** 옆모습이라 왼쪽으로 갈 때 좌우를 뒤집어야 하는 동작 */
  side?: boolean
}

/** 오른쪽부터 시계 방향으로 45°씩. 화면 좌표라 아래가 +y 다. */
export const GAZE_DIRS = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'] as const
export type GazeDir = typeof GAZE_DIRS[number]
export interface Gaze {
  /** [줄, 칸] 목록. 여러 칸이면 왕복하며 재생한다. */
  cells: Array<[number, number]>
  frameMs: number
}

export interface Character {
  sheet: string
  /** 눈 감은 프레임만 모은 시트. 대기 줄에 깜빡임이 없는 캐릭터만 쓴다. */
  blinkSheet?: string
  frameW: number
  frameH: number
  cols: number
  rows: number
  /** 보통 크기에서의 확대 배율 */
  baseScale: number
  /** 픽셀 아트는 정수배로만 키우고 보간 없이 그린다 */
  pixelated: boolean
  clips: Partial<Record<ClipName, Clip>> & { idle: Clip; walkRight: Clip }
  /** 커서 쪽을 쳐다볼 때 보여줄 칸. 없으면 몸 방향만 돌린다. */
  gaze?: Record<GazeDir, Gaze>
}

const CLIP_FALLBACK: Record<ClipName, ClipName[]> = {
  idle: [],
  blink: [],
  walkRight: [],
  walkLeft: [],
  sit: ['idle'],
  wave: ['jump', 'idle'],
  jump: ['wave', 'idle'],
  sad: ['sit', 'idle'],
  doze: ['sit', 'idle'],
  wait: ['think', 'idle'],
  think: ['wait', 'sit', 'idle'],
  idleAlt: ['idle'],
  look: ['idleAlt', 'idle'],
}

export function resolveClip(c: Character, name: ClipName): { name: ClipName; clip: Clip } {
  for (const n of [name, ...CLIP_FALLBACK[name]]) {
    const clip = c.clips[n]
    if (clip) return { name: n, clip }
  }
  return { name: 'idle', clip: c.clips.idle }
}

/** 기본 캐릭터. 한 줄짜리 픽셀 시트: 0~3 걷기, 4 서기, 5~7 앉아서 꼬리 흔들기. */
export const DOG: Character = {
  sheet: dogSheet,
  blinkSheet: dogBlinkSheet,
  frameW: 64,
  frameH: 56,
  cols: 8,
  rows: 1,
  baseScale: 2,
  pixelated: true,
  clips: {
    idle: { row: 0, frames: [4], frameMs: 1000, side: true },
    walkRight: { row: 0, frames: [0, 1, 2, 3], frameMs: 0, side: true },
    sit: { row: 0, frames: [5, 6, 7, 6], frameMs: 130 },
  },
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/**
 * ChatGPT Pets 시트의 줄 순서.
 * 대기(깜빡임 포함) · 오른쪽 걷기 · 왼쪽 걷기 · 손 흔들기 · 점프 · 시무룩 ·
 * 기다리기 · 생각하기 · 가만히 · 두리번 · 두리번
 */
const PETS_ROWS: Array<[ClipName, number]> = [
  ['walkRight', 110],
  ['walkLeft', 110],
  ['wave', 150],
  ['jump', 110],
  ['sad', 170],
  ['wait', 150],
  ['think', 180],
  ['idleAlt', 170],
  ['look', 170],
]

/** 대기 줄이 이만큼 커 보이게 맞춘다(px). 실제 크기는 설정의 크기 배율을 곱한다. */
const PETS_DISPLAY_H = 112

export function fromPetsSheet(sheet: string, m: CharacterMeta): Character {
  const frameW = m.width / m.cols
  const frameH = m.height / m.rows
  const clips: Character['clips'] = {
    // 대기 줄 첫 칸은 눈을 뜬 기본 자세, 줄 전체는 깜빡임으로 쓴다.
    idle: { row: 0, frames: [0], frameMs: 1000 },
    blink: { row: 0, frames: range(m.counts[0]), frameMs: 70 },
    walkRight: { row: 1, frames: range(m.counts[1]), frameMs: 0 },
  }
  PETS_ROWS.forEach(([name, frameMs], i) => {
    const count = m.counts[i + 1] ?? 0
    if (count > 0) clips[name] = { row: i + 1, frames: range(count), frameMs }
  })
  // 시무룩 줄 가운데의 눈 감은 칸을 느리게 반복하면 꾸벅꾸벅 조는 모습이 된다.
  const sad = clips.sad
  if (sad && sad.frames.length >= 5) clips.doze = { row: sad.row, frames: [3, 4], frameMs: 900 }

  // 두리번 두 줄(16칸)을 시선 방향별로 나눈다. 한 칸도 버리지 않는다.
  // 첫 줄: 0 위 · 1 오른쪽 위 · 2~5 오른쪽 · 6 오른쪽 아래 · 7 아래
  // 둘째 줄: 0 아래 · 1 왼쪽 아래 · 2~4,7 왼쪽 · 5~6 왼쪽 위
  const g = (cells: Array<[number, number]>): Gaze => ({ cells, frameMs: 320 })
  const gaze: Character['gaze'] = (m.counts[9] ?? 0) >= 8 && (m.counts[10] ?? 0) >= 8
    ? {
        up: g([[9, 0]]),
        upRight: g([[9, 1]]),
        right: g([[9, 2], [9, 3], [9, 4], [9, 5]]),
        downRight: g([[9, 6]]),
        down: g([[9, 7], [10, 0]]),
        downLeft: g([[10, 1]]),
        left: g([[10, 2], [10, 3], [10, 4], [10, 7]]),
        upLeft: g([[10, 5], [10, 6]]),
      }
    : undefined

  return {
    gaze,
    sheet,
    frameW,
    frameH,
    cols: m.cols,
    rows: m.rows,
    baseScale: PETS_DISPLAY_H / frameH,
    pixelated: false,
    clips,
  }
}

/** 크기 배율을 실제 확대 배율로. 픽셀 아트는 정수배여야 블록이 뭉개지지 않는다. */
export function displayScale(c: Character, size: number): number {
  const s = c.baseScale * size
  return c.pixelated ? Math.max(1, Math.floor(s + 1e-6)) : s
}
