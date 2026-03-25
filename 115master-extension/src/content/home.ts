/**
 * 115 主页 Content Script
 * 功能：
 * - 文件列表视频封面
 * - 标题显示路径
 * - 点击播放打开独立播放器页面
 */
import { getVideoCovers } from '../lib/videoThumbnail'
import homeCss from './home.css?inline'

/**
 * 文件信息接口
 */
interface FileInfo {
  pickCode: string
  fileName: string
  isVideo: boolean
  sha1?: string
  duration: number
  cateId?: string
}

/**
 * 时间字符串解析为秒
 * @example "10:00" => 600, "01:00:00" => 3600
 */
function getDuration(time?: string): number {
  if (!time) return 0
  const [seconds = 0, minutes = 0, hours = 0] = time
    .split(':')
    .map(Number)
    .reverse()
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * 简易并发调度器
 */
class Scheduler {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private maxConcurrent: number = 3) {}

  async add<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      if (this.queue.length > 0) {
        const next = this.queue.shift()
        next?.()
      }
    }
  }
}

const coverScheduler = new Scheduler(3)

/**
 * 尝试从115页面全局变量中获取DataListBox选择器
 */
function getDataListBoxSelector(): string {
  try {
    // 115 页面的全局变量 Main.CONFIG.DataListBox
    const w = window as any
    if (w.Main?.CONFIG?.DataListBox) {
      return w.Main.CONFIG.DataListBox
    }
  } catch {}
  // 回退到常见选择器
  return '#js_data_list'
}

/**
 * 文件列表修改器
 */
class FileListMod {
  private observer: MutationObserver | null = null
  private dataListBoxSelector: string = '#js_data_list'
  private mainWorldConfig: any = null
  private prefetchedPickCodes = new Set<string>()
  private lastOpenMeta: { pickCode: string, ts: number } | null = null
  private playEventsBoundDocs = new WeakSet<Document>()

  constructor() {
    this.init()
  }

  /**
   * 初始化
   */
  private init() {
    console.log('[115Master] 开始初始化 FileListMod...')

    // 等待文件列表容器加载
    this.waitForFileList().then(() => {
      console.log('[115Master] 文件列表容器已找到，开始处理文件项')
      this.bindPlayOpenEvents()
      this.updateFileItems()
      this.watchFileListChanges()
    })
  }

  /**
   * DOM 诊断 —— 打印关键元素是否存在
   */
  private diagnoseDom(targetDoc: Document = document, reason: string = 'init') {
    const selectors = [
      '#js_data_list',
      '#js_data_list_box',
      '.list-cell',
      '.list-contents',
      '.list-thumb',
      '#js_center_main_box',
      '.file-list',
    ]

    const scope = targetDoc === document ? 'main' : 'wangpan-iframe'
    console.log(`[115Master] ===== DOM 诊断开始 (${reason}, ${scope}) =====`)
    selectors.forEach(s => {
      const el = targetDoc.querySelector(s)
      console.log(`[115Master] ${s}: ${el ? '✅ 存在' : '❌ 不存在'}`)
    })

    // 检查是否能找到任何有 pick_code 属性的 li
    const allLi = targetDoc.querySelectorAll('li[pick_code]')
    console.log(`[115Master] li[pick_code] 数量: ${allLi.length}`)

    if (allLi.length > 0) {
      const first = allLi[0] as HTMLElement
      console.log('[115Master] 找到包含 pick_code 的元素属性:', {
        tagName: first.tagName,
        pick_code: first.getAttribute('pick_code') || first.getAttribute('pickcode'),
        title: first.getAttribute('title')?.slice(0, 30),
        className: first.className,
      })
    } else {
      // 深度嗅探：打印 #js_center_main_box 下的所有类名，看 115 是不是改版了
      const mainBox = targetDoc.querySelector('#js_center_main_box')
      if (mainBox) {
        console.log('[115Master] 深度嗅探 main_box 的子结构，寻找可能的列表容器...')
        const children = mainBox.querySelectorAll('div, ul, li, table, tbody, tr')
        const uniqueClasses = new Set<string>()
        children.forEach(el => {
          if (el.className && typeof el.className === 'string') {
            const cls = el.className.split(' ').find(c => c && c.includes('list') || c.includes('item') || c.includes('row'))
            if (cls) uniqueClasses.add(cls)
          }
        })
        console.log('[115Master] 发现的潜在列表类名:', Array.from(uniqueClasses))
      }

      // 额外嗅探：看看页面上有没有 iframe
      if (targetDoc === document) {
        const iframes = document.querySelectorAll('iframe')
        console.log('[115Master] 页面上的 iframe 数量:', iframes.length)
      }
    }

    // 获取 115 页面配置
    try {
      const w = window as any
      if (w.Main?.CONFIG) {
        console.log('[115Master] Main.CONFIG.DataListBox:', w.Main.CONFIG.DataListBox)
      } else {
        console.log('[115Master] Main.CONFIG: ❌ 不存在 (可能需要从页面注入访问)')
      }
    } catch (e) {
      console.log('[115Master] 无法访问 Main.CONFIG:', e)
    }
    console.log('[115Master] ===== DOM 诊断结束 =====')
  }

  /**
   * 跨 iframe 获取容器
   */
  private getTargetDocument(): Document {
    const wFrame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement
    if (wFrame && wFrame.contentDocument) {
      return wFrame.contentDocument
    }
    return document
  }

  /**
   * 等待文件列表容器加载（多策略）
   */
  private async waitForFileList(): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0
      const waitStart = Date.now()
      let lastWaitLog = 0
      let hasPrintedDeepDiagnose = false

      // 首次诊断：主文档 + 当前目标文档
      this.diagnoseDom(document, 'init-main')
      const initTargetDoc = this.getTargetDocument()
      if (initTargetDoc !== document) {
        this.diagnoseDom(initTargetDoc, 'init-target')
      }

      const checkExist = setInterval(() => {
        attempts++
        const targetDoc = this.getTargetDocument()

        // 策略1: 尝试 已知选择器
        this.dataListBoxSelector = getDataListBoxSelector()
        const box1 = targetDoc.querySelector(this.dataListBoxSelector)
        if (box1) {
          console.log(`[115Master] 找到容器 (策略1): ${this.dataListBoxSelector}`)
          clearInterval(checkExist)
          resolve()
          return
        }

        // 策略1.5: 常见列表容器兜底
        const box15 = targetDoc.querySelector('.list-contents') || targetDoc.querySelector('.list-cell')
        if (box15) {
          const el = box15 as HTMLElement
          this.dataListBoxSelector = el.id ? `#${el.id}` : '.list-contents'
          if (!el.id) {
            el.setAttribute('data-115master-watch', 'true')
          }
          console.log('[115Master] 找到容器 (策略1.5): 通用列表容器')
          clearInterval(checkExist)
          resolve()
          return
        }

        // 策略2: 通过文件项反推容器（兼容 pick_code/cate_id）
        const anyItem = targetDoc.querySelector('li[pick_code], li[pickcode], div[pick_code], div[pickcode], li[cate_id], div[cate_id], li[file_type], div[file_type]')
        if (anyItem) {
          // 找到文件列表项了，找它所在的容器
          const listContainer = anyItem.closest('.list-cell, .list-contents, ul, table, tbody') || anyItem.parentElement
          if (listContainer) {
            // 从列表容器再往上找观察目标
            const observeTarget = listContainer.parentElement ?? listContainer
            this.dataListBoxSelector = observeTarget.id
              ? `#${observeTarget.id}`
              : '.list-cell-parent'
            // 给它标记一个 id 方便后续查找
            if (!observeTarget.id) {
              observeTarget.setAttribute('data-115master-watch', 'true')
            }
            console.log(`[115Master] 找到容器 (策略2): 通过 li[pick_code] 反推, 标签=${observeTarget.tagName}, id=${observeTarget.id}, class=${observeTarget.className?.slice(0, 50)}`)
            clearInterval(checkExist)
            resolve()
            return
          }
        }

        const elapsed = Date.now() - waitStart

        // 每 10 秒打印一次简要等待日志，避免刷屏
        if (Date.now() - lastWaitLog >= 10000) {
          lastWaitLog = Date.now()
          console.log(`[115Master] 等待文件列表中... ${elapsed}ms`) 
        }

        // 30 秒还没找到时，补一次深度诊断
        if (!hasPrintedDeepDiagnose && elapsed >= 30000) {
          hasPrintedDeepDiagnose = true
          this.diagnoseDom(targetDoc, 'wait-30s')
        }

        // 最长等待 60 秒，超时后降级到 body 监听，避免无限轮询
        if (elapsed >= 60000) {
          console.log('[115Master] 等待文件列表超时，降级为 body 监听模式')
          clearInterval(checkExist)
          resolve()
        }
      }, 100)
    })
  }

  /**
   * 监听文件列表变化
   */
  private watchFileListChanges() {
    const targetDoc = this.getTargetDocument()
    let watchTarget = targetDoc.querySelector(this.dataListBoxSelector)
      ?? targetDoc.querySelector('[data-115master-watch]')
      ?? targetDoc.body

    console.log(`[115Master] 监听目标: ${(watchTarget as HTMLElement).tagName}`)

    this.observer = new MutationObserver(() => {
      this.updateFileItems()
    })

    this.observer.observe(watchTarget, {
      childList: true,
      subtree: true,
    })
  }

  /**
   * 更新文件列表项
   */
  private updateFileItems() {
    const targetDoc = this.getTargetDocument()
    const fileItems = targetDoc.querySelectorAll('li[pick_code], li[pickcode], div[pick_code], div[pickcode], li[cate_id], div[cate_id]')
    if (fileItems.length === 0) return

    let processedCount = 0
    fileItems.forEach((item) => {
      if (!item.hasAttribute('data-115master-processed')) {
        this.processFileItem(item as HTMLElement)
        processedCount++
      }
    })

    if (processedCount > 0) {
      console.log(`[115Master] 处理了 ${processedCount} 个新文件项`)
    }
  }

  /**
   * 处理单个文件项
   */
  private processFileItem(item: HTMLElement) {
    item.setAttribute('data-115master-processed', 'true')

    // 获取文件信息
    const fileInfo = this.extractFileInfo(item)
    if (!fileInfo) return

    if (!fileInfo.isVideo) {
      if (fileInfo.cateId) {
        this.addFastFolderEntry(item, fileInfo)
      }
      return
    }

    // 延迟一点再挂封面，避免列表刷新瞬间闪烁
    setTimeout(() => {
      if (!item.isConnected) return
      if (!item.hasAttribute('data-115master-processed')) return
      this.addVideoCover(item, fileInfo)
    }, 180)

    // 添加下载拦截（反 115 浏览器挟持）
    this.addDownloadIntercept(item, fileInfo)

    // 显示完整路径标题
    this.updateTitleWithPath(item, fileInfo)
  }

  private bindPlayOpenEvents() {
    const targetDoc = this.getTargetDocument()
    if (this.playEventsBoundDocs.has(targetDoc)) return
    this.playEventsBoundDocs.add(targetDoc)

    const getVideoInfoFromEvent = (e: Event): FileInfo | null => {
      const target = e.target as HTMLElement | null
      if (!target) return null

      const nameHit = target.closest('.file-thumb, .file-name .name, .file-name')
      if (!nameHit) return null

      const item = target.closest('li[pick_code], li[pickcode], div[pick_code], div[pickcode], li[cate_id], div[cate_id]') as HTMLElement | null
      if (!item) return null

      const fileInfo = this.extractFileInfo(item)
      if (!fileInfo || !fileInfo.isVideo) return null
      return fileInfo
    }

    targetDoc.addEventListener('mouseover', (e) => {
      const fileInfo = getVideoInfoFromEvent(e)
      if (!fileInfo) return
      this.prefetchVideoSource(fileInfo.pickCode)
    }, true)

    targetDoc.addEventListener('mousedown', (e) => {
      const mouseEvent = e as MouseEvent
      if (mouseEvent.button !== 0) return
      const fileInfo = getVideoInfoFromEvent(e)
      if (!fileInfo) return

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      this.prefetchVideoSource(fileInfo.pickCode)
    }, true)

    targetDoc.addEventListener('click', (e) => {
      const mouseEvent = e as MouseEvent
      if (mouseEvent.button !== 0) return
      const fileInfo = getVideoInfoFromEvent(e)
      if (!fileInfo) return

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      this.openPlayer(fileInfo.pickCode, fileInfo.fileName)
    }, true)

    targetDoc.addEventListener('dblclick', (e) => {
      const fileInfo = getVideoInfoFromEvent(e)
      if (!fileInfo) return

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }, true)

    console.log('[115Master] 播放点击链路已切换为文档级单入口拦截')
  }

  /**
   * 文件夹瞬间进入
   */
  private addFastFolderEntry(item: HTMLElement, fileInfo: FileInfo) {
    const fileNameNode = item.querySelector('.file-thumb') ?? item.querySelector('.file-name .name')
    if (!fileNameNode) return

    const handleFolderClick = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      
      console.log('[115Master] 瞬间进入文件夹:', fileInfo.cateId)
      if (top) {
        top.location.href = `https://115.com/?cid=${fileInfo.cateId}&offset=0&mode=wangpan`
      }
    }

    // 在捕获阶段拦截，防止 115 默认较慢的加载逻辑触发
    fileNameNode.addEventListener('click', handleFolderClick, true)
    item.addEventListener('dblclick', handleFolderClick, true)
  }

  /**
   * 拦截官方限制下载的恶心设定，替换为提取出直链后走扩展下载/IDM 接管
   */
  private addDownloadIntercept(item: HTMLElement, fileInfo: FileInfo) {
    const downloadNode = item.querySelector('.file-opr a[menu="download_one"]') as HTMLElement
    if (!downloadNode) return

    downloadNode.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      try {
        downloadNode.style.opacity = '0.5' // 视觉反馈

        const { drive115 } = await import('../lib/drive115')
        const res = await drive115.getFileDownloadUrl(fileInfo.pickCode)
        
        if (res.url?.url) {
          // 发给后台强制静默下载，浏览器、IDM均可直接拦截并吃满网速
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD',
            data: {
              url: res.url.url,
              filename: fileInfo.fileName
            }
          })
          console.log('[115Master] 下载任务已推送至浏览器下载器或 IDM')
        } else {
          throw new Error('拿不到真实下载地址喵！')
        }
      } catch (error) {
        console.error('[115Master] 解析下载直链失败:', error)
        alert('解析下载直链失败: ' + (error instanceof Error ? error.message : String(error)))
      } finally {
        downloadNode.style.opacity = '1'
      }
    }, true)
  }

  /**
   * 提取文件信息
   */
  private extractFileInfo(item: HTMLElement): FileInfo | null {
    try {
      const pickCode = item.getAttribute('pick_code') || item.getAttribute('pickcode') || ''
      const cateId = item.getAttribute('cate_id') || ''
      
      if (!pickCode && !cateId) return null

      const fileName = item.getAttribute('title') || ''

      // 判断是否是视频
      const ivAttr = item.getAttribute('iv')
      const isVideo = ivAttr === '1'

      const sha1 = item.getAttribute('sha1') || undefined

      // 时长：从子元素 .duration 读取
      const durationNode = item.querySelector('.duration')
      const durationStr = durationNode?.getAttribute('duration')
        ?? durationNode?.textContent?.trim()
        ?? ''
      const duration = getDuration(durationStr)

      const fileInfo: FileInfo = { pickCode, fileName, isVideo, sha1, duration, cateId }

      console.log('[115Master] 文件:', fileName.slice(0, 30), {
        pickCode, cateId, isVideo, duration, durationStr,
        hasDurationNode: !!durationNode,
      })
      return fileInfo
    }
    catch (error) {
      console.error('[115Master] 提取文件信息失败:', error)
      return null
    }
  }

  /**
   * 添加视频封面
   */
  private addVideoCover(item: HTMLElement, fileInfo: FileInfo) {
    if (item.hasAttribute('data-115master-cover-added')) return

    // 只在列表视图下添加
    const targetDoc = this.getTargetDocument()
    const listContents = targetDoc.querySelector('.list-contents')
    if (!listContents) {
      console.log('[115Master] 非列表视图，跳过封面')
      return
    }

    if (!fileInfo.duration) {
      console.log('[115Master] 无 duration，跳过封面:', fileInfo.pickCode)
      return
    }

    item.setAttribute('data-115master-cover-added', 'true')

    // 让 li 高度自适应
    item.classList.add('with-ext-video-cover')

    // 创建封面容器
    const container = document.createElement('div')
    container.className = 'master115-cover-container'
    container.style.opacity = '0'
    container.style.transition = 'opacity 0.15s ease'

    // 骨架屏
    const skeleton = document.createElement('div')
    skeleton.className = 'master115-cover-skeleton'
    skeleton.textContent = '加载封面中...'
    container.appendChild(skeleton)

    // 追加到 li 末尾换行展示
    item.appendChild(container)

    // 懒加载
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          io.unobserve(container)
          io.disconnect()
          this.loadThumbnails(container, fileInfo)
        }
      })
    }, { rootMargin: '200px' })
    io.observe(container)
  }

  /**
   * 加载缩略图
   */
  private async loadThumbnails(container: HTMLElement, fileInfo: FileInfo) {
    const { pickCode, duration } = fileInfo
    if (!pickCode || !duration) return

    console.log('[115Master] 开始加载缩略图:', pickCode, 'duration:', duration)

    try {
      const results = await coverScheduler.add(() =>
        getVideoCovers(pickCode, duration, 5)
      )

      container.innerHTML = ''
      container.classList.add('master115-cover-loaded')
      container.style.opacity = '1'

      if (results.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'master115-cover-empty'
        empty.textContent = '暂无封面'
        container.appendChild(empty)
        return
      }

      results.forEach((res, index) => {
        const link = document.createElement('a')
        link.className = 'master115-cover-thumb'
        link.href = res.imgUrl
        link.style.width = '139px'
        link.style.height = '96px'
        link.style.display = 'inline-block'
        link.style.overflow = 'hidden'
        link.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          this.showLightbox(res.imgUrl)
        })

        const img = document.createElement('img')
        img.src = res.imgUrl
        img.alt = `视频封面 ${index + 1}`
        img.className = 'master115-cover-img'
        img.style.width = '139px'
        img.style.height = '96px'
        img.style.objectFit = 'cover'
        img.style.display = 'block'

        link.appendChild(img)
        container.appendChild(link)
      })

      console.log('[115Master] 缩略图加载成功:', pickCode, results.length, '张')
    } catch (e) {
      console.error('[115Master] 缩略图加载失败:', pickCode, e)
      container.innerHTML = ''
      const err = document.createElement('div')
      err.className = 'master115-cover-error'
      err.textContent = '封面加载失败'
      container.appendChild(err)
      container.style.opacity = '1'
    }
  }

  private prefetchVideoSource(pickCode: string) {
    if (!pickCode) return
    if (this.prefetchedPickCodes.has(pickCode)) return
    this.prefetchedPickCodes.add(pickCode)

    chrome.runtime.sendMessage({
      type: 'PREFETCH_VIDEO_SOURCE',
      data: { pickCode },
    }).catch(() => {
      this.prefetchedPickCodes.delete(pickCode)
    })
  }

  /**
   * 打开播放器
   */
  private openPlayer(pickCode: string, title: string) {
    const now = Date.now()
    if (this.lastOpenMeta && this.lastOpenMeta.pickCode === pickCode && now - this.lastOpenMeta.ts < 1200) {
      console.log('[115Master] 忽略重复打开请求:', pickCode)
      return
    }
    this.lastOpenMeta = { pickCode, ts: now }

    const playerUrl = chrome.runtime.getURL('src/player/index.html')
    const url = `${playerUrl}?pickCode=${pickCode}&title=${encodeURIComponent(title)}`

    // 固定单通道打开：仅走用户手势 window.open，彻底避免同页被改写成播放器
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (opened) {
      this.prefetchVideoSource(pickCode)
      return
    }

    // 不再回退当前页跳转，避免出现“原页也变播放页”
    console.warn('[115Master] 浏览器拦截了新标签打开，请允许弹窗后重试')
  }

  /**
   * 更新标题显示路径
   */
  private updateTitleWithPath(item: HTMLElement, fileInfo: FileInfo) {
    const targetDoc = this.getTargetDocument()
    const breadcrumb = targetDoc.querySelector('.js-breadcrumb') as HTMLElement
    const pathText = breadcrumb?.textContent?.trim() || ''
    if (!pathText) return

    const fileNameNode = item.querySelector('.file-name .name') as HTMLElement
    if (fileNameNode) {
      const fullPath = `${pathText} / ${fileInfo.fileName}`
      fileNameNode.setAttribute('title', fullPath)
    }
  }

  /**
   * 极简灯箱展示大图
   */
  private showLightbox(imgSrc: string) {
    const targetDoc = this.getTargetDocument()
    let lightbox = targetDoc.getElementById('master115-lightbox')
    if (!lightbox) {
      lightbox = targetDoc.createElement('div')
      lightbox.id = 'master115-lightbox'
      lightbox.className = 'master115-lightbox'
      const img = targetDoc.createElement('img')
      lightbox.appendChild(img)

      // 点击关闭
      lightbox.addEventListener('click', () => {
        lightbox?.classList.remove('active')
      })
      targetDoc.body.appendChild(lightbox)
    }

    const imgNode = lightbox.querySelector('img')
    if (imgNode) {
      imgNode.src = imgSrc
    }
    // 小延迟出动画
    requestAnimationFrame(() => {
      lightbox?.classList.add('active')
    })
  }

  destroy() {
    this.observer?.disconnect()
    this.observer = null
  }
}

/**
 * 初始化
 */
let fileListMod: FileListMod | null = null

function init() {
  const w = window as any
  if (w.__115masterHomeInited) {
    console.log('[115Master] 检测到重复注入，跳过初始化')
    return
  }

  // 只在顶层页面运行，避免 all_frames 下重复注入导致重复监听/重复开页
  if (window.top !== window) {
    console.log('[115Master] 跳过子 frame 注入')
    return
  }

  w.__115masterHomeInited = true

  const url = window.location.href
  console.log('[115Master] Content Script loaded, URL:', url)

  // 扩展播放器页自身不注入，避免在 player 页误触发任何 115 页面逻辑
  if (url.startsWith('chrome-extension://') && url.includes('/src/player/index.html')) {
    console.log('[115Master] 跳过扩展播放器页面注入')
    return
  }

  // 排除 bridge/static iframe（参考项目也排除这些）
  if (url.includes('/bridge') || url.includes('/static') || url.includes('q.115.com')) {
    console.log('[115Master] 跳过非主页面:', url)
    return
  }

  console.log('[115Master] Content Script initialized on:', url)
  fileListMod = new FileListMod()
}

// 确保样式在 head 就绪后注入
function injectStyles() {
    // 主页面注入 CSS
    if (document.head) {
      const styleEl = document.createElement('style')
      styleEl.textContent = homeCss
      document.head.appendChild(styleEl)
    }

    // wangpan iframe 注入 CSS
    const wFrame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement
    if (wFrame && wFrame.contentDocument && wFrame.contentDocument.head) {
      const styleEl = document.createElement('style')
      styleEl.textContent = homeCss
      wFrame.contentDocument.head.appendChild(styleEl)
    }
}

injectStyles()

function closeAnyVisibleLightbox() {
  const docs: Document[] = [document]
  const wFrame = document.querySelector('iframe[name="wangpan"]') as HTMLIFrameElement | null
  if (wFrame?.contentDocument) {
    docs.push(wFrame.contentDocument)
  }

  docs.forEach((doc) => {
    const lightbox = doc.getElementById('master115-lightbox')
    if (lightbox) {
      lightbox.classList.remove('active')
      const img = lightbox.querySelector('img') as HTMLImageElement | null
      if (img) {
        img.src = ''
      }
    }
  })
}

// 全局捕获拦截：在最早阶段阻断 115 原生视频打开逻辑，确保只走扩展播放器链路
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null
  if (!target) return

  const nameHit = target.closest('.file-thumb, .file-name .name, .file-name')
  if (!nameHit) return

  const item = target.closest('li[pick_code], li[pickcode], div[pick_code], div[pickcode]') as HTMLElement | null
  if (!item) return

  const ivAttr = item.getAttribute('iv')
  if (ivAttr !== '1') return

  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
}, true)

window.addEventListener('error', (event) => {
  const message = event.message || ''
  if (message.includes('Extension context invalidated')) {
    console.warn('[115Master] 检测到扩展上下文失效，请在扩展管理页重新加载插件后刷新页面')
  }
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    closeAnyVisibleLightbox()
    init()
  })
} else {
  closeAnyVisibleLightbox()
  init()
}

window.addEventListener('beforeunload', () => {
  fileListMod?.destroy()
  ;(window as any).__115masterHomeInited = false
})
