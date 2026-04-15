import type { M3u8Item } from '../lib/types'
import type { FileItem } from '../lib/api/types'

export interface MsgSetCookie {
  type: 'SET_COOKIE'
  data: {
    name: string
    value: string
    path: string
    domain: string
    secure: boolean
    expirationDate: number
    sameSite: string
  }
}

export interface MsgDownload {
  type: 'DOWNLOAD'
  data: {
    url: string
    filename: string
  }
}

export interface MsgGetHistory {
  type: 'GET_HISTORY'
  data: { pickCode: string }
}

export interface MsgGetHistoryMap {
  type: 'GET_HISTORY_MAP'
}

export interface MsgSetHistory {
  type: 'SET_HISTORY'
  data: {
    pickCode: string
    fileName: string
    currentTime: number
    duration: number
    quality: string
  }
}

export interface MsgOpenTab {
  type: 'OPEN_TAB'
  url: string
}

export interface MsgFetchM3u8 {
  type: 'FETCH_M3U8'
  data: { pickCode: string }
}

export interface MsgMainWorldFetch {
  type: 'MAIN_WORLD_FETCH'
  data: { url: string, body: string }
}

export interface MsgMainWorldGet {
  type: 'MAIN_WORLD_GET'
  data: { url: string }
}

export interface MsgFetchPlaylist {
  type: 'FETCH_PLAYLIST'
  data: { cid: string, pickCode?: string }
}

export interface MsgMoveFile {
  type: 'MOVE_FILE'
  data: {
    fileId: string
    parentId: string
    cid: string
  }
}

export interface MsgDeleteFile {
  type: 'DELETE_FILE'
  data: {
    fileId: string
    parentId: string
    pickCode: string
  }
}

export interface MsgPing {
  type: 'PING'
}

export interface MsgTranscode {
  type: 'TRANSCODE_ACCELERATE'
  data: { pickCode: string }
}

export interface MsgFetchPlaylistResponse {
  list?: FileItem[]
  path?: Array<{ cid: string, name: string }>
  error?: string
}

export interface MsgMoveSuccessRefresh {
  type: 'MOVE_SUCCESS_REFRESH'
}

export interface MsgDeleteSuccessRefresh {
  type: 'DELETE_SUCCESS_REFRESH'
  data: {
    fileId: string
    parentId: string
    pickCode: string
  }
}

export type RuntimeMessage =
  | MsgSetCookie
  | MsgDownload
  | MsgGetHistory
  | MsgGetHistoryMap
  | MsgSetHistory
  | MsgOpenTab
  | MsgFetchM3u8
  | MsgMainWorldFetch
  | MsgMainWorldGet
  | MsgFetchPlaylist
  | MsgMoveFile
  | MsgDeleteFile
  | MsgPing
  | MsgMoveSuccessRefresh
  | MsgDeleteSuccessRefresh
  | MsgTranscode
