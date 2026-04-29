export type PlaybackMode = 'next' | 'repeat' | 'stop'

const PLAYBACK_MODE_STORAGE_KEY = '115m-playback-mode'

export function getPlaybackModeLabel(mode: PlaybackMode): string {
  switch (mode) {
    case 'repeat':
      return '重播'
    case 'stop':
      return '停止'
    case 'next':
    default:
      return '连播'
  }
}

export function getPlaybackModeOptions(): PlaybackMode[] {
  return ['next', 'repeat', 'stop']
}

export function loadPlaybackMode(): PlaybackMode {
  try {
    const raw = localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY)
    if (raw === 'next' || raw === 'repeat' || raw === 'stop') {
      return raw
    }
  }
  catch {
    // ignore storage errors
  }
  return 'next'
}

export function savePlaybackMode(mode: PlaybackMode) {
  try {
    localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, mode)
  }
  catch {
    // ignore storage errors
  }
}

export function buildPlaybackModePlan(mode: PlaybackMode, hasNext: boolean) {
  if (mode === 'repeat') {
    return 'repeat' as const
  }
  if (mode === 'next' && hasNext) {
    return 'next' as const
  }
  return 'stop' as const
}
