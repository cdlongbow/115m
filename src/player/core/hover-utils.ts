export interface HoverCover {
  time: number
  imgUrl: string
}

export function formatTimeLabel(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0')
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toFixed(3).padStart(6, '0')
  return `${h}:${m}:${s}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function findNearestCover(covers: HoverCover[], hoverTime: number): HoverCover | null {
  if (!covers.length) return null
  let nearest = covers[0]
  let minDelta = Math.abs(nearest.time - hoverTime)
  for (const cover of covers) {
    const delta = Math.abs(cover.time - hoverTime)
    if (delta < minDelta) {
      minDelta = delta
      nearest = cover
    }
  }
  return nearest
}
