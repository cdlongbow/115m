import type { M3u8Item } from '../../lib/types'
import { fetchBestDownloadResult } from '../../lib/pro-api'
import { buildPlaylistProgressSnapshot, loadPlayHistoryMap, loadQualityPreference, type QualityPreference } from './history'
import { resolveInitialPlayback, type InitialPlaybackPlan } from './startup'
import { fetchPlaylistResponse } from './player-api'
import { normalizePlaylistItems } from './playlist'
import type { OverlayPathItem, OverlayPlaylistItem } from './overlay'
import { fetchM3u8WithRetry } from './source'

type RuntimeSender = <T = unknown>(message: unknown) => Promise<T | null>

export interface ResolvedPlaybackBundle {
  qualityPreference: QualityPreference | null
  ultraUrl: string | null
  m3u8List: M3u8Item[]
  initialPlayback: InitialPlaybackPlan
}

export async function resolvePlaybackBundle(
  sendMessage: RuntimeSender,
  pickCode: string,
  canUseNativeUltraSource = true,
): Promise<ResolvedPlaybackBundle> {
  const qualityPreference = await loadQualityPreference(pickCode)
  let m3u8Error: unknown = null
  let ultraError: unknown = null

  const m3u8Promise = fetchM3u8WithRetry(pickCode).catch((error) => {
    m3u8Error = error
    return [] as M3u8Item[]
  })

  const ultraPromise = fetchBestDownloadResult(sendMessage, pickCode).catch((error) => {
    ultraError = error
    return null
  })

  const [downloadResult, m3u8List] = await Promise.all([ultraPromise, m3u8Promise])
  const ultraUrl = downloadResult?.url?.url || null
  const resolvedM3u8List = Array.isArray(m3u8List) ? m3u8List : []

  console.log('[115m][preview] playback sources', {
    pickCode,
    ultraAvailable: !!ultraUrl,
    m3u8Count: resolvedM3u8List.length,
    m3u8Qualities: resolvedM3u8List.map(item => ({
      quality: item.quality,
      name: item.name,
      url: item.url.slice(0, 120),
    })),
    previewAssetsHint: 'No standalone VTT/sprite source detected in current playback bundle',
  })

  if (m3u8Error && !ultraUrl) {
    console.warn('[115m] fetchM3u8WithRetry failed:', m3u8Error)
  }
  else if (m3u8Error) {
    console.debug('[115m] m3u8 unavailable, fallback to ultra source')
  }

  if (ultraError && resolvedM3u8List.length === 0) {
    console.warn('[115m] fetchUltraSource failed:', ultraError)
  }
  else if (ultraError) {
    console.debug('[115m] ultra source unavailable, fallback to m3u8 source')
  }

  if (downloadResult?.url?.auth_cookie) {
    await sendMessage({
      type: 'SET_COOKIE',
      data: {
        name: downloadResult.url.auth_cookie.name,
        value: downloadResult.url.auth_cookie.value,
        path: '/',
        domain: '.115cdn.net',
        secure: true,
        expirationDate: Number(downloadResult.url.auth_cookie.expire),
        sameSite: 'no_restriction',
      },
    })
  }

  const initialPlayback = resolveInitialPlayback({
    qualityPreference,
    ultraUrl,
    canUseNativeUltraSource,
    m3u8List: resolvedM3u8List,
  })

  if (!initialPlayback) {
    throw new Error('无法获取任何播放源，请检查网络或是否需要人机验证')
  }

  return {
    qualityPreference,
    ultraUrl,
    m3u8List: resolvedM3u8List,
    initialPlayback,
  }
}

export async function fetchBreadcrumbPath(
  sendMessage: RuntimeSender,
  cid: string,
  pickCode: string,
): Promise<OverlayPathItem[]> {
  const response = await fetchPlaylistResponse(sendMessage, cid, pickCode)
  return response?.path ?? []
}

export async function fetchPlaylistData(params: {
  sendMessage: RuntimeSender
  cid: string
  pickCode: string
  formatFileSize: (size: number) => string
  onPath?: (items: OverlayPathItem[]) => void
}): Promise<OverlayPlaylistItem[]> {
  const response = await fetchPlaylistResponse(params.sendMessage, params.cid, params.pickCode)
  if (response?.path?.length) {
    params.onPath?.(response.path)
  }

  const list = response?.list || []
  const items = normalizePlaylistItems(list, params.formatFileSize)
  return await attachPlaylistProgress(items)
}

async function attachPlaylistProgress(items: OverlayPlaylistItem[]): Promise<OverlayPlaylistItem[]> {
  if (items.length === 0) return items

  const historyMap = await loadPlayHistoryMap()
  return items.map((item) => {
    const snapshot = buildPlaylistProgressSnapshot(historyMap[item.pickCode])
    if (!snapshot) {
      return item
    }

    return {
      ...item,
      progressSec: snapshot.progressSec,
      progressPercent: snapshot.progressPercent,
    }
  })
}
