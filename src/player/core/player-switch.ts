import type { OverlayPlaylistItem } from './overlay'
import { buildNavigateToVideoUrl } from './player-query'

export function findPlaylistItemByPickCode(items: OverlayPlaylistItem[], pickCode: string) {
  return items.find(item => item.pickCode === pickCode)
}

export function buildOverlayMetaPatch(targetItem?: OverlayPlaylistItem) {
  if (!targetItem) return null

  return {
    title: targetItem.name,
    fileId: targetItem.fileId,
    fileSize: targetItem.size || '',
    isMarked: targetItem.isMarked === true,
  }
}

export function buildPlayerHistoryUrl(params: {
  pathname: string
  search: string
  pickCode: string
  targetItem?: OverlayPlaylistItem
  keepPlaylistOpen: boolean
}) {
  return buildNavigateToVideoUrl(
    params.pathname,
    params.search,
    params.pickCode,
    {
      title: params.targetItem?.name,
      fileId: params.targetItem?.fileId,
      fileSize: params.targetItem?.size,
      isMarked: params.targetItem?.isMarked,
      keepPlaylistOpen: params.keepPlaylistOpen,
    },
  )
}
