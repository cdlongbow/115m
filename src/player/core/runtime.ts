export async function sendRuntimeMessageSafe<T = unknown>(message: unknown): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage(message) as T
  }
  catch {
    return null
  }
}
