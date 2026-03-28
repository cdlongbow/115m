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
      if (result !== undefined && result !== null) {
        return result
      }
      // result 为 null/undefined 也重试
      console.warn('[115m] sendMessage got null, retrying...', i)
    }
    catch (e) {
      console.warn('[115m] sendMessage error, retrying...', i, e)
    }
    if (i < retries) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  console.warn('[115m] sendRuntimeMessage failed after retries:', message)
  return null
}
