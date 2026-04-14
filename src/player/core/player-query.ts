import type { OverlayPathItem } from './overlay'

export interface PlayerBootstrapConfig {
  pickCode: string | null
  traceId?: string
  clickTs?: number
}

export interface OverlayMetaQuery {
  title: string
  fileSize: string
  fileId: string
  cid: string
  parentId: string
  isMarked: boolean
  path: OverlayPathItem[]
}

export function readPlayerBootstrapConfig(search: string): PlayerBootstrapConfig {
  const params = new URLSearchParams(search)
  const pickCode = params.get('pickCode')
  const traceId = params.get('traceId') || undefined
  const clickTsRaw = params.get('clickTs')
  const clickTs = clickTsRaw ? Number(clickTsRaw) : undefined

  return { pickCode, traceId, clickTs }
}

export function readPlaylistCidFromLocation(search: string): string {
  return new URLSearchParams(search).get('cid') || ''
}

export function readPathFromLocation(search: string): OverlayPathItem[] {
  const rawPath = new URLSearchParams(search).get('path')
  if (!rawPath) return []

  try {
    const parsed = JSON.parse(rawPath) as OverlayPathItem[]
    return Array.isArray(parsed)
      ? parsed.filter(item => !!item?.cid && !!item?.name)
      : []
  }
  catch {
    return []
  }
}

export function readOverlayMetaQuery(search: string): OverlayMetaQuery {
  const params = new URLSearchParams(search)
  const cid = params.get('cid') || ''

  return {
    title: params.get('title') || '视频播放',
    fileSize: params.get('fileSize') || '',
    fileId: params.get('fileId') || '',
    cid,
    parentId: cid,
    isMarked: params.get('marked') === '1',
    path: readPathFromLocation(search),
  }
}

export function buildNavigateToVideoUrl(pathname: string, search: string, pickCode: string, title?: string): string {
  const params = new URLSearchParams(search)
  params.set('pick_code', pickCode)
  params.set('pickCode', pickCode)
  if (title) {
    params.set('title', title)
  }
  return `${pathname}?${params.toString()}`
}

export function buildUpdatedMarkedUrl(pathname: string, search: string, nextMarked: boolean): string {
  const params = new URLSearchParams(search)
  params.set('marked', nextMarked ? '1' : '0')
  return `${pathname}?${params.toString()}`
}
