/**
 * 下载结果
 */
export interface DownloadResult {
  url: {
    auth_cookie?: {
      expire: string
      name: string
      path: string
      value: string
    }
    url: string
  }
}

/**
 * 视频下载接口响应
 */
export interface FilesDownloadRes {
  state: boolean
  errNo?: number
  file_url?: string
}

/**
 * Pro 下载接口响应
 */
export interface ProDownurlRes {
  state: boolean
  data: string
}

/**
 * M3U8 接口响应
 */
export interface VideoM3u8Res {
  state?: boolean
  code?: number
  error?: string
}

/**
 * 文件列表响应
 */
export interface FilesRes {
  state: boolean
  path?: Array<{
    cid: string
    name: string
  }>
  data?: FileItem[]
  count?: number
}

export interface FileItem {
  fid: string
  fc: number
  fn: string
  fl: number
  fp: string
  fs: number
  fm: string
  ic: string
  md5?: string
  sha?: string
  pick_code: string
  s: number
  iv?: number
  cid?: string
  pid?: string
  attributes?: {
    pick_code: string
  }
}

/**
 * 文件视频信息响应
 * 注意：115 API 返回的数据在顶层，没有 data 包装层
 */
export interface FilesVideoRes {
  state: boolean
  parent_id: string
  file_id: string
  is_mark: string
  file_name?: string
  file_size?: string
  pick_code?: string
  sha1?: string
  width?: string
  height?: string
  video_url?: string
  audio_list?: string
  definition_list?: any
  definition_index?: any
  video_info?: {
    [key: string]: string
  }
}
