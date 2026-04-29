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

export function blurTime(time: number, interval: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return 0
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    return clamp(time, 0, duration)
  }

  const blurred = Math.round(time / interval) * interval
  return clamp(Math.round(blurred * 10) / 10, 0, duration)
}

export function findNearestCover(covers: HoverCover[], hoverTime: number, maxDelta = 30): HoverCover | null {
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
  // 如果最近的封面距离超过最大允许距离，返回 null
  // 这样会触发精确封面加载，而不是显示一个过远的封面
  if (minDelta > maxDelta) {
    return null
  }
  return nearest
}
