// 立即覆盖原生页面（在 document_start 阶段，阻止任何原生内容渲染）
;(function overrideNativePage() {
  if (window.top !== window) return
  if (!/\/web\/lixian\/master\/video\//.test(window.location.pathname)) return
  // 停止当前文档解析，用 document.write 完全替换
  document.open()
  document.write(`
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="utf-8">
    <title>115m 播放器</title>
    <style>
      html,body{margin:0;padding:0;width:100%;height:100%;background:#000;}
      #m115-app{display:flex;flex-direction:column;height:100vh;color:#fff;font-family:sans-serif;}
      #m115-header{position:relative;z-index:20;padding:8px 16px;display:flex;align-items:center;gap:8px;}
      #m115-btn-back{border:0;background:transparent;color:rgba(255,255,255,.6);cursor:pointer;font-size:16px;}
      #m115-btn-back:hover{color:#fff;}
      #video-title{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      #artplayer-app{width:100%;flex:1;display:flex;align-items:center;justify-content:center;}
      #loading{position:fixed;inset:0;z-index:40;background:#000;display:flex;align-items:center;justify-content:center;}
      #loading-text{color:rgba(255,255,255,.7);font-size:14px;}
    </style>
    </head>
    <body>
    <div id="m115-app">
      <header id="m115-header">
        <button id="btn-back" title="返回">←</button>
        <h1 id="video-title">加载中...</h1>
      </header>
      <div id="artplayer-app"></div>
      <div id="loading"><p id="loading-text">正在获取视频信息...</p></div>
      <div id="error-overlay" style="display:none"></div>
    </div>
    </body>
    </html>
  `)
  document.close()
})()

function mountPlayerShell() {
  // 页面已经被上面的 document.write 完全覆盖，这里不需要再操作
}

function clearNativeVideoRequests() {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    entries
      .filter(e => /proapi\.115\.com\/app\/chrome\/downurl/.test(e.name))
      .forEach(e => performance.clearResourceTimings())
  }
  catch {
    // ignore
  }
}

async function init() {
  if (window.top !== window) return
  if (!/\/web\/lixian\/master\/video\//.test(window.location.pathname)) return

  mountPlayerShell()
  clearNativeVideoRequests()

  const params = new URLSearchParams(window.location.search)
  const pickCode = params.get('pickCode') || params.get('pick_code') || ''
  if (!pickCode) return
  if (!params.get('pickCode')) {
    params.set('pickCode', pickCode)
  }

  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  await import('../player/player')
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void init() })
}
else {
  void init()
}
