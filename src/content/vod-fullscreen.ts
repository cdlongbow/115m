/**
 * 115vod.com 自动网页全屏
 * 等待 DPlayer 加载完成后自动触发网页全屏
 */

console.log('[115m] 115vod auto web-fullscreen loading...')

function tryWebFullscreen(): boolean {
  // 方案1: 通过 DPlayer 实例 API
  const dp = (window as any).dp
  if (dp?.fullScreen?.request) {
    dp.fullScreen.request('web')
    console.log('[115m] 115vod web-fullscreen triggered via DPlayer API')
    return true
  }

  // 方案2: 点击网页全屏按钮
  const btn = document.querySelector('.dplayer-full-in-icon') as HTMLElement
    || document.querySelector('[data-balloon="网页全屏"]') as HTMLElement
    || document.querySelector('.dplayer-webfullscreen-icon') as HTMLElement
  if (btn) {
    btn.click()
    console.log('[115m] 115vod web-fullscreen triggered via button click')
    return true
  }

  return false
}

function waitForPlayerAndFullscreen() {
  // 立即尝试
  if (tryWebFullscreen()) return

  // 轮询等待播放器加载（最多 10 秒）
  let attempts = 0
  const maxAttempts = 40
  const timer = setInterval(() => {
    attempts++
    if (tryWebFullscreen() || attempts >= maxAttempts) {
      clearInterval(timer)
      if (attempts >= maxAttempts) {
        console.log('[115m] 115vod web-fullscreen: player not found after timeout')
      }
    }
  }, 250)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForPlayerAndFullscreen)
} else {
  waitForPlayerAndFullscreen()
}
