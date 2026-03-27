// 极轻量页面早期接管 - 同步执行，不经过 Vite 打包
// 在 115 原生行内脚本执行之前覆盖页面，阻止 "undefined action!" 渲染
if(window.top===window&&/\/web\/lixian\/master\/video\//.test(window.location.pathname)){
  document.open();
  document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>115m</title><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000}#m115-app{display:flex;flex-direction:column;height:100vh;color:#fff;font-family:sans-serif}#artplayer-app{width:100%;flex:1;display:flex;align-items:center;justify-content:center}#loading{position:fixed;inset:0;z-index:40;background:#000;display:flex;align-items:center;justify-content:center}#loading-text{color:rgba(255,255,255,.7);font-size:14px}</style></head><body><div id="m115-app"><div id="artplayer-app"></div><div id="loading"><p id="loading-text">正在获取视频信息...</p></div><div id="error-overlay" style="display:none"></div></div></body></html>');
  document.close();
}
