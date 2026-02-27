import { useRef, useState } from 'react'

interface ResizablePanelProps {
  children: React.ReactNode
}

const MIN_W = 280
const MAX_W = 700
const MIN_H = 360
const MAX_H = 800

type Direction = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const CURSORS: Record<Direction, string> = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
}

const EDGE_SIZE = 6

export function ResizablePanel({ children }: ResizablePanelProps) {
  const [size, setSize] = useState({ width: 320, height: 440 })
  const sizeRef = useRef(size)
  sizeRef.current = size

  const startResize = (e: React.MouseEvent, dir: Direction) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startW = sizeRef.current.width
    const startH = sizeRef.current.height

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX
      const dy = me.clientY - startY

      let newW = startW
      let newH = startH

      if (dir.includes('e')) newW = Math.max(MIN_W, Math.min(MAX_W, startW + dx))
      if (dir.includes('w')) newW = Math.max(MIN_W, Math.min(MAX_W, startW - dx))
      if (dir.includes('s')) newH = Math.max(MIN_H, Math.min(MAX_H, startH + dy))
      if (dir.includes('n')) newH = Math.max(MIN_H, Math.min(MAX_H, startH - dy))

      setSize({ width: newW, height: newH })
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="panel" style={{ width: size.width, height: size.height }}>
      {/* 4개 모서리 */}
      {(['nw', 'ne', 'sw', 'se'] as Direction[]).map((dir) => (
        <div
          key={dir}
          className={`rhandle corner-${dir}`}
          style={{ cursor: CURSORS[dir], width: EDGE_SIZE * 2, height: EDGE_SIZE * 2 }}
          onMouseDown={(e) => startResize(e, dir)}
        />
      ))}
      {/* 4개 가장자리 */}
      {(['n', 's', 'e', 'w'] as Direction[]).map((dir) => (
        <div
          key={dir}
          className={`rhandle edge-${dir}`}
          style={{ cursor: CURSORS[dir] }}
          onMouseDown={(e) => startResize(e, dir)}
        />
      ))}
      {children}
    </div>
  )
}
