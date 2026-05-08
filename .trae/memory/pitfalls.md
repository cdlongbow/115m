# 踩坑记忆

## 用途

- 记录已经验证无效、容易误判、会导致回归的路径
- 后续 AI 处理同类问题时必须先看本文件，避免重复踩坑

## 播放器 404 排查踩坑

### 不要把所有 404 都归因到缩略图本身

- 早期曾误判为单纯 `videoThumbnail` 或 `hls.js` 动态导入问题
- 实际第一层根因是播放器页启动链在页面环境动态 import，导致 Vite chunk 相对路径按 `/assets/*` 请求
- 已修复的启动链问题：
  - `public/video-page-early.js` 不再读取 `.vite/manifest.json` 和动态 import `video-page`
  - `src/content/video-page.ts` 不再运行时 `await import('../player/player')`
  - 若仍看到 `https://115.com/assets/player-*.js`、`player-playlist-cache-*.js`、`m3u8-parser-*.js`，必须优先复查 `src/content/video-page.ts` 是否又回归为运行时动态 import

### 以下方法已验证不治本，不要重复当作根因修复

- 只禁用进度条预览图
- 只禁用播放列表缩略图
- 只把 `hls.ts` 改为静态导入
- 只调整进度条 UI 或移除视觉标记
- 只清浏览器缓存或只刷新扩展

### 缩略图链的真实剩余入口

- 主启动链修复后，剩余 `videoThumbnail / player-playlist-cache / m3u8-parser` 404 已收敛到缩略图子系统
- 已隔离并验证过的入口：
  - `overlay-playlist.ts` 播放列表缩略图入口已可通过 `PLAYLIST_COVER_FEATURE_ENABLED = false` 关闭
  - `src/player/player.ts` 的 `setupProgressHoverPreview()` 已移除 `primeThumbnailSourceUrl` 动态导入预热入口
- 进度条 hover preview 的长期恢复方案：
  - 不要恢复运行时 `import('../../lib/videoThumbnail')`
  - 应在 `hover-preview-session.ts` 顶层静态导入 `getTimelineCovers / getVideoCoverAt / getVideoCovers`
  - `THUMBNAIL_PREVIEW_ENABLED` 可开启，但前提是不能重新引入运行时动态导入
- 如果仍有 `videoThumbnail / m3u8-parser / player-playlist-cache` 404，优先怀疑：
  - `hover-preview-session.ts` 或其他播放器模块重新引入了运行时动态导入
  - 非播放器页或 content 侧仍存在 `videoThumbnail` 动态导入入口
  - 页面未刷新扩展或仍在运行旧版构建产物

### blob 错误不要和 chunk 404 混为一谈

- `blob:https://115.com/... net::ERR_FILE_NOT_FOUND` 与 chunk 404 不是同一层问题
- blob 错误来源是缩略图/VTT 的对象 URL 生命周期，不是 `/assets/*` chunk 路径错误
- 已采用长期修法：
  - `src/lib/videoThumbnail.ts` 不再向 UI 暴露截图 blob URL，`renderCover()` 直接输出稳定 `data:` URL
  - `writeTimelineCovers()` 和批量缓存写入复用 `coverToStorableDataUrl()`
  - `src/player/core/hover-preview.ts` 已移除 `artplayerPluginThumbnail:update` 的 VTT blob track 更新，只保留自定义 hover 预览 UI
  - 缩略图缓存版本已升到 `v4`，绕开旧 `v3` 中可能残留的 `blob:` 地址
  - 缓存读取统一走 `normalizeCachedCovers()`，过滤 `blob:` 等非稳定图片地址
- 后续如果再出现 blob ERR_FILE_NOT_FOUND，优先检查：
  - 是否又有缩略图图片以 `blob:` 形式进入 `HoverCover.imgUrl`
  - 是否有人恢复了 `artplayerPluginThumbnail:update` 或 VTT blob track
  - 是否存在旧构建产物或旧缓存 data 之外的 blob URL

### 文件写入风险

- 本轮排查历史中曾出现多个文件被误截断/误覆盖风险
- 修改已有文件前必须先读当前文件内容
- 大文件优先小范围替换，避免整文件重写造成截断
- 对播放器核心文件尤其谨慎：
  - `src/player/player.ts`
  - `src/player/core/runtime.ts`
  - `src/player/core/history.ts`
  - `src/player/core/player-services.ts`
  - `src/lib/videoThumbnail.ts`
