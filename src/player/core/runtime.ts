/**
 * 检测是否为扩展上下文失效错误（扩展更新/重载后旧页面的连接会断开）
 */
function isContextInvalidated(e: unknown): boolean {
  return e instanceof Error && /Extension context invalidated/i.test(e.message)
}

/**
 * 扩展上下文失效时，提示用户刷新页面
 */
function showContextInvalidatedTip() {
  // 避免重复提示
  if (document.getElementById('ext-invalidated-tip')) return
  const tip = document.createElement('div')
  tip.id = 'ext-invalidated-tip'
  tip.style.cssText = [
    'position:fixed',
    'top:20px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:999999',
    'background:rgba(0,0,0,.85)',
    'color:#fff',
    'padding:12px 24px',
    'border-radius:8px',
    'font-size:14px',
    'cursor:pointer',
    'box-shadow:0 4px 20px rgba(0,0,0,.5)',
  ].join(';')
  tip.textContent = '扩展已更新，点击刷新页面'
  tip.addEventListener('click', () => location.reload())
  document.body.appendChild(tip)
}

/**
 * 确保 Service Worker 已就绪
 * 浏览器重启后 SW 可能处于冷启动状态，需要等待它完全加载
 * 通过发送一个简单的 ping 消息来唤醒 SW
 */
export async function ensureServiceWorkerReady(maxRetries = 5, delay = 500): Promise<void> {
  console.log('[115m] ensureServiceWorkerReady: starting...')
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'PING' })
      console.log('[115m] ensureServiceWorkerReady: PING response', result)
      if (result) return
    }
    catch (e) {
      if (isContextInvalidated(e)) {
        // Extension reload invalidates the old page context. Show a refresh tip without polluting error panels.
        showContextInvalidatedTip()
        return
      }
      console.warn('[115m] ensureServiceWorkerReady: PING error, retrying...', i, e)
    }
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  console.error('[115m] Service Worker not ready after retries')
}

/**
 * 向 background 发送消息，带重试机制
 * Service Worker 冷启动时可能还没准备好，需要重试
 */
export async function sendRuntimeMessageSafe<T = unknown>(
  message: unknown,
  retries = 3,
  delay = 1000,
): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await chrome.runtime.sendMessage(message) as T
      if (result !== undefined) {
        return result
      }
      // result 为 undefined 时重试（可能由于 Service Worker 尚未就绪导致没有响应）
      console.warn('[115m] sendMessage got undefined, retrying...', i)
    }
    catch (e) {
      if (isContextInvalidated(e)) {
        // Extension reload invalidates the old page context. Show a refresh tip without polluting error panels.
        showContextInvalidatedTip()
        return null
      }
      console.warn('[115m] sendMessage error, retrying...', i, e)
    }
    if (i < retries) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  console.warn('[115m] sendRuntimeMessage failed after retries:', message)
  return null
}
