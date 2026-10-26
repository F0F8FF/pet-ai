/**
 * ChatGPT Pets 형식 캐릭터 시트 분석.
 * 시트는 가로 8칸 고정 격자이고, 줄마다 동작 하나(대기·오른쪽 걷기·왼쪽 걷기…)가 들어 있다.
 * 줄 수와 줄마다 채워진 칸 수는 시트마다 달라서, 투명 여백을 보고 직접 센다.
 */

export const SHEET_COLS = 8

export interface CharacterMeta {
  file: string
  width: number
  height: number
  cols: number
  rows: number
  /** 줄마다 그림이 들어 있는 칸 수 */
  counts: number[]
}

const ALPHA_ON = 24

/** px는 픽셀당 4바이트(RGBA 또는 BGRA). 알파는 어느 쪽이든 네 번째 바이트다. */
export function analyzeSheet(px: Uint8Array, width: number, height: number): Omit<CharacterMeta, 'file'> | string {
  if (width < SHEET_COLS * 16 || height < 48) return '이미지가 너무 작아요'
  const alpha = (x: number, y: number) => px[(y * width + x) * 4 + 3]

  let clear = 0
  let sampled = 0
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      sampled++
      if (alpha(x, y) < ALPHA_ON) clear++
    }
  }
  if (clear / sampled < 0.15) return '배경이 투명한 PNG 시트여야 해요'

  // 그림이 있는 가로줄 띠를 찾는다. 귀 끝처럼 몇 픽셀 끊기는 틈은 같은 줄로 본다.
  const filled: boolean[] = []
  for (let y = 0; y < height; y++) {
    let on = false
    for (let x = 0; x < width && !on; x++) on = alpha(x, y) >= ALPHA_ON
    filled.push(on)
  }
  const bands: Array<[number, number]> = []
  for (let y = 0; y < height; y++) {
    if (!filled[y]) continue
    const last = bands[bands.length - 1]
    if (last && y - last[1] <= 3) last[1] = y
    else bands.push([y, y])
  }
  const rows = bands.filter(([a, b]) => b - a >= 6).length
  if (rows < 3 || rows > 24) return '격자를 찾지 못했어요. ChatGPT Pets 시트인지 확인해 주세요'

  // 줄 높이가 균일한 격자인지 확인: 띠 가운데가 각자 자기 칸 안에 있어야 한다.
  const cellH = height / rows
  const tall = bands.filter(([a, b]) => b - a >= 6)
  if (tall.some(([a, b], i) => Math.floor((a + b) / 2 / cellH) !== i)) {
    return '줄 간격이 고르지 않아요. ChatGPT Pets 시트인지 확인해 주세요'
  }

  const cellW = width / SHEET_COLS
  const counts: number[] = []
  for (let r = 0; r < rows; r++) {
    let count = 0
    for (let c = 0; c < SHEET_COLS; c++) {
      const x0 = Math.round(c * cellW), x1 = Math.round((c + 1) * cellW)
      const y0 = Math.round(r * cellH), y1 = Math.round((r + 1) * cellH)
      let on = false
      for (let y = y0; y < y1 && !on; y += 2) {
        for (let x = x0; x < x1 && !on; x += 2) on = alpha(x, y) >= ALPHA_ON
      }
      if (on) count = c + 1
    }
    counts.push(count)
  }
  if (counts[0] === 0 || (counts[1] ?? 0) === 0) return '대기·걷기 줄이 비어 있어요'

  return { width, height, cols: SHEET_COLS, rows, counts }
}
