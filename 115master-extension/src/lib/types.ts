/**
 * 115 视频画质映射
 */
export const qualityCodeMap: Record<string, number> = {
  '3G': 360,
  'SD': 480,
  'HD': 720,
  'UD': 1080,
  'BD': 2160,
  'YH': 9999,
}

export const qualityNumMap: Record<number, string> = {
  360: '360P',
  480: '480P',
  720: '720P',
  1080: '1080P',
  2160: '4K',
  9999: 'Ultra',
}

export interface M3u8Item {
  name: string
  quality: number
  url: string
}

export interface VideoSource {
  name: string
  url: string
  type: 'auto' | 'hls'
  displayQuality: string
}
