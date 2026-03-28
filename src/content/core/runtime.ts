/**
 * 向 background 发送消息，带重试机制
 * Service Worker 冷启动时可能还没准备好，需要重试
 */
export async function sendRuntimeMessageSafe<T = unknown>(
  message: unknown,
  retries = 2,
  delay = 300,
): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await chrome.runtime.sendMessage(message) as T
    }
    catch {
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  console.warn('[115m] sendRuntimeMessage failed after retries:', message)
  return null
}
