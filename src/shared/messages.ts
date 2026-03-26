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

export interface MsgFetchM3u8 {
  type: 'FETCH_M3U8'
  data: { pickCode: string }
}

export interface MsgMainWorldFetch {
  type: 'MAIN_WORLD_FETCH'
  data: { url: string, body: string }
}

export type RuntimeMessage =
  | MsgSetCookie
  | MsgDownload
  | MsgGetHistory
  | MsgSetHistory
  | MsgOpenTab
  | MsgFetchM3u8
  | MsgMainWorldFetch
