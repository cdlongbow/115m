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
 */
export interface FilesVideoRes {
  state: boolean
  data?: {
    video_info?: {
      [key: string]: string
    }
  }
}
