/**
 * 视频播放 Token 拦截 Content Script
 * 用于拦截 115 视频播放的 token，并发送给 background 设置 cookie
 */

// 拦截 fetch 请求
const originalFetch = window.fetch

window.fetch = new Proxy(originalFetch, {
  apply(target, thisArg, args) {
    const [url, options] = args as [string, RequestInit]

    // 拦截视频 token 请求
    if (url.includes('/video/token')) {
      console.log('[115Master] 拦截到视频 token 请求:', url)

      return target.apply(thisArg, args as any).then((response) => {
        // 克隆响应以便读取
        const clonedResponse = response.clone()

        clonedResponse.json().then((data) => {
          if (data.state && data.data) {
            // 发送消息给 background 设置 cookie
            chrome.runtime.sendMessage({
              type: 'SET_COOKIE',
              data: {
                name: data.data.name,
                value: data.data.value,
                path: data.data.path,
                domain: data.data.domain,
                secure: data.data.secure,
                expirationDate: data.data.expire,
                sameSite: data.data.sameSite,
              },
            }).catch((error) => {
              console.error('[115Master] 发送 token 到 background 失败:', error)
            })
          }
        }).catch((error) => {
          console.error('[115Master] 解析 token 响应失败:', error)
        })

        return response
      })
    }

    return target.apply(thisArg, args as any)
  },
})

console.log('[115Master] Video Token Interceptor initialized')
