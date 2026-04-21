export function shouldRetryNativePlayback(params: { retryCount: number, hasStartedPlaying: boolean }) {
  return !params.hasStartedPlaying && params.retryCount < 1
}

const NATIVE_PLAYABLE_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'ogv',
  'ogg',
])

function readExtension(value: string) {
  const clean = value.split('?')[0].split('#')[0].trim().toLowerCase()
  const lastDot = clean.lastIndexOf('.')
  if (lastDot < 0 || lastDot === clean.length - 1) return ''
  return clean.slice(lastDot + 1)
}

export function canUseNativeUltraSource(title: string, ultraUrl: string | null) {
  const titleExt = readExtension(title)
  if (titleExt) {
    return NATIVE_PLAYABLE_EXTENSIONS.has(titleExt)
  }

  const urlExt = readExtension(ultraUrl || '')
  if (urlExt) {
    return NATIVE_PLAYABLE_EXTENSIONS.has(urlExt)
  }

  return true
}
