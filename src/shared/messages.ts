import type { M3u8Item } from '../lib/types'

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

export interface MsgPrefetchVideoSource {
  type: 'PREFETCH_VIDEO_SOURCE'
  data: { pickCode: string }
}

export interface MsgGetPrefetchVideoSource {
  type: 'GET_PREFETCH_VIDEO_SOURCE'
  data: { pickCode: string }
}

export interface MsgSetPrefetchVideoSource {
  type: 'SET_PREFETCH_VIDEO_SOURCE'
  data: {
    pickCode: string
    url: string
    authCookie?: {
      expire: string
      name: string
      path: string
      value: string
    } | null
  }
}

export interface MsgGetPrefetchM3u8 {
  type: 'GET_PREFETCH_M3U8'
  data: { pickCode: string }
}

export interface MsgFetchM3u8 {
  type: 'FETCH_M3U8'
  data: { pickCode: string }
}

export type RuntimeMessage =
  | MsgSetCookie
  | MsgDownload
  | MsgGetHistory
  | MsgSetHistory
  | MsgOpenTab
  | MsgPrefetchVideoSource
  | MsgGetPrefetchVideoSource
  | MsgSetPrefetchVideoSource
  | MsgGetPrefetchM3u8
  | MsgFetchM3u8

export interface PrefetchVideoSourceResponse {
  url: string
  fromCache: boolean
}

export interface PrefetchM3u8Response {
  list: M3u8Item[]
  fromCache: boolean
}
