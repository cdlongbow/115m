import type HlsType from 'hls.js'
import type { HlsConfig } from 'hls.js'

let hlsModulePromise: Promise<typeof import('hls.js')> | null = null

async function loadHlsModule(): Promise<typeof import('hls.js')> {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js')
  }
  return hlsModulePromise
}

export async function getHlsConstructor(): Promise<typeof import('hls.js').default> {
  const module = await loadHlsModule()
  return module.default
}

export async function isHlsSupported(): Promise<boolean> {
  const Hls = await getHlsConstructor()
  return Hls.isSupported()
}

export async function createHlsInstance(
  video: HTMLVideoElement,
  url: string,
  overrides: Partial<HlsConfig> = {},
): Promise<HlsType> {
  const Hls = await getHlsConstructor()
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 90,
    ...overrides,
  })
  hls.loadSource(url)
  hls.attachMedia(video)
  return hls
}
