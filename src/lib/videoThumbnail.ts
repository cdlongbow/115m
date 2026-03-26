import { drive115 } from './drive115'
import { M3U8ClipperNew } from './clipper/m3u8Clipper'
import { getImageResize } from './image'

const MAX_WIDTH = 720
const MAX_HEIGHT = 720
const memoryCoverCache = new Map<string, VideoThumbnail[]>()

function getStorageArea(): chrome.storage.StorageArea | null {
  const area = (globalThis as any)?.chrome?.storage?.local as chrome.storage.StorageArea | undefined
  return area ?? null
}

export interface VideoThumbnail {
  imgUrl: string
  width: number
  height: number
  time: number
}

function calculateTimes(duration: number, count = 5): number[] {
  const offset = duration / 5
  const minTime = offset
  const maxTime = duration - offset
  const range = maxTime - minTime

  return Array.from({ length: count }, (_, i) =>
    Math.floor(minTime + (range / count) * i)
  )
}

export async function getVideoCovers(pickCode: string, duration: number, coverNum = 5): Promise<VideoThumbnail[]> {
  console.log('[115Master] getVideoCovers 开始:', { pickCode, duration, coverNum })

  const CACHE_KEY = `master115_covers_${pickCode}_${coverNum}`
  const inMemory = memoryCoverCache.get(CACHE_KEY)
  if (inMemory && inMemory.length > 0) {
    return inMemory
  }

  const storageArea = getStorageArea()
  try {
    if (storageArea) {
      const cached = await storageArea.get(CACHE_KEY)
      if (cached[CACHE_KEY] && cached[CACHE_KEY].length > 0) {
        const hit = cached[CACHE_KEY] as VideoThumbnail[]
        memoryCoverCache.set(CACHE_KEY, hit)
        console.log('[115Master] 命中本地强缓存，瞬间读取出图:', pickCode)
        return hit
      }
    }
    else {
      console.warn('[115Master] 当前上下文不可用 chrome.storage.local，封面缓存降级为内存缓存')
    }
  } catch (e) {
    console.warn('[115Master] 读取缓存失败:', e)
  }

  const m3u8List = await drive115.getM3u8(pickCode)
  console.log('[115Master] m3u8List:', m3u8List.map(m => ({ name: m.name, quality: m.quality })))

  const source = m3u8List.sort((a, b) => a.quality - b.quality)[0] // use lowest quality for fastest decode
  if (!source) throw new Error('No m3u8 source found')

  console.log('[115Master] 使用源:', source.name, source.url.slice(0, 80))

  const clipper = new M3U8ClipperNew({ url: source.url })
  await clipper.open()
  console.log('[115Master] clipper 已打开, segments:', clipper.hlsIo.segments.length)

  const times = calculateTimes(duration, coverNum)
  console.log('[115Master] 截取时间点:', times)

  const results: VideoThumbnail[] = []

  for (const t of times) {
    try {
      console.log('[115Master] 正在 seek:', t, 's')
      const result = await clipper.seek(t, true)
      if (result) {
        const resize = getImageResize(result.videoFrame.displayWidth, result.videoFrame.displayHeight, MAX_WIDTH, MAX_HEIGHT)
        const canvas = new OffscreenCanvas(resize.width, resize.height)
        const ctx = canvas.getContext('2d')

        if (ctx) {
          ctx.drawImage(
            await createImageBitmap(result.videoFrame, {
              resizeQuality: 'pixelated', 
              resizeWidth: resize.width, 
              resizeHeight: resize.height
            }), 
            0, 0, resize.width, resize.height
          )
          const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
          const base64Url = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })

          results.push({
            imgUrl: base64Url,
            width: resize.width,
            height: resize.height,
            time: t
          })
          console.log('[115Master] 封面截取成功:', t, 's, 尺寸:', resize.width, 'x', resize.height)
        }
        result.videoFrame.close()
      }
    } catch (e) {
      console.warn('[115Master] seek error for time', t, e)
    }
  }

  clipper.destroy()
  console.log('[115Master] getVideoCovers 完成:', pickCode, '成功', results.length, '张')

  if (results.length > 0) {
    memoryCoverCache.set(CACHE_KEY, results)
    try {
      if (storageArea) {
        await storageArea.set({ [CACHE_KEY]: results })
        console.log('[115Master] 强缓存已写入数据库永久保存:', pickCode)
      }
    } catch (e) {
      console.warn('[115Master] 写入缓存失败:', e)
    }
  }

  return results
}
