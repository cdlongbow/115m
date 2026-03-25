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

  constructor() {
    this.init()
  }

  /**
   * 初始化
   */
  private init() {
    console.log('[115Master] 开始初始化 FileListMod...')

    // 先诊断 DOM 结构
    this.diagnoseDom()

    // 等待文件列表容器加载
    this.waitForFileList().then(() => {
      console.log('[115Master] 文件列表容器已找到，开始处理文件项')
      this.updateFileItems()
      this.watchFileListChanges()
    })
  }

  /**
   * DOM 诊断 —— 打印关键元素是否存在
   */
  private diagnoseDom() {
    const selectors = [
      '#js_data_list',
      '#js_data_list_box',
      '.list-cell',
      '.list-contents',
      '.list-thumb',
      '#js_center_main_box',
      '.file-list',
    ]

    console.log('[115Master] ===== DOM 诊断开始 =====')
    selectors.forEach(s => {
      const el = document.querySelector(s)
      console.log(`[115Master] ${s}: ${el ? '✅ 存在' : '❌ 不存在'}`)
    })

    // 检查是否能找到任何有 pick_code 属性的 li
    const allLi = document.querySelectorAll('li[pick_code]')
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
      const mainBox = document.querySelector('#js_center_main_box')
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
      const iframes = document.querySelectorAll('iframe')
      console.log('[115Master] 页面上的 iframe 数量:', iframes.length)
      iframes.forEach((ifr, i) => {
        console.log(`[115Master] iframe[${i}]: id="${ifr.id}" name="${ifr.name}" src="${ifr.src}"`)
      })
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

        // 策略2: 通过 li[pick_code] 的父元素反推容器
        const anyLi = targetDoc.querySelector('li[pick_code]') || targetDoc.querySelector('[pick_code], [pickcode]')
        if (anyLi) {
          // 找到文件列表项了，找它所在的容器
          const listContainer = anyLi.closest('.list-cell') || anyLi.parentElement
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

        // 每 3 秒打印一次等待日志
        if (attempts % 30 === 0) {
          console.log(`[115Master] 仍在等待 iframe 内部文件列表... (${attempts * 100}ms)`)
          this.diagnoseDom()
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
    const fileItems = targetDoc.querySelectorAll('li[pick_code], li[pickcode], div[pick_code], div[pickcode]')
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

    if (!fileInfo.isVideo) return

    // 添加视频封面
    this.addVideoCover(item, fileInfo)

    // 添加点击播放事件
    this.addClickPlay(item, fileInfo)

    // 添加下载拦截（反 115 浏览器挟持）
    this.addDownloadIntercept(item, fileInfo)

    // 显示完整路径标题
    this.updateTitleWithPath(item, fileInfo)
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
      if (!pickCode) return null

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

      const fileInfo: FileInfo = { pickCode, fileName, isVideo, sha1, duration }

      console.log('[115Master] 文件:', fileName.slice(0, 30), {
        pickCode, isVideo, duration, durationStr,
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

    // 让 li 高度自适应
    item.classList.add('with-ext-video-cover')

    // 创建封面容器
    const container = document.createElement('div')
    container.className = 'master115-cover-container'

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
        link.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          this.showLightbox(res.imgUrl)
        })

        const img = document.createElement('img')
        img.src = res.imgUrl
        img.alt = `视频封面 ${index + 1}`
        img.className = 'master115-cover-img'

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
    }
  }

  /**
   * 添加点击播放事件
   */
  private addClickPlay(item: HTMLElement, fileInfo: FileInfo) {
    const fileNameNode = item.querySelector('.file-thumb') ?? item.querySelector('.file-name .name')

    const handleClickPlayer = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation() // 极力阻止115默认行为
      this.openPlayer(fileInfo.pickCode)
    }

    if (fileNameNode) {
      // 核心：必须使用 capture: true 在捕获阶段拦截点击，否则 115 会提早跳转
      fileNameNode.addEventListener('click', handleClickPlayer, true)
    }

    // 双击整行使用 Master 播放
    item.addEventListener('dblclick', handleClickPlayer)

    // 鼠标中键：保留回退后门，中键点击依然使用 115 原生播放器
    item.addEventListener('auxclick', (e: Event) => {
      const mouseEvent = e as MouseEvent
      if (mouseEvent.button === 1) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        const url = `https://115.com/s/vod/?pickcode=${fileInfo.pickCode}&share_id=0`
        window.open(url, '_blank')
      }
    })
  }

  /**
   * 打开播放器
   */
  private openPlayer(pickCode: string) {
    const playerUrl = chrome.runtime.getURL('src/player/index.html')
    const url = `${playerUrl}?pickCode=${pickCode}`
    // 发送消息给后台，让后台权限去打开标签页，完美绕过屏蔽器
    chrome.runtime.sendMessage({
      type: 'OPEN_TAB',
      url: url
    })
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
  const url = window.location.href
  console.log('[115Master] Content Script loaded, URL:', url)

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

window.addEventListener('beforeunload', () => {
  fileListMod?.destroy()
})
