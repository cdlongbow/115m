# 踩坑记忆

## 用途

- 只记录已验证无效、容易误判、会导致回归的路径
- 不记录普通过程、工具迁移或无后续排查价值的信息

## 播放器 404 与缩略图链路

### 不要把所有 404 都归因到缩略图本身

- 播放器页 `/assets/*` 404 的关键风险是页面环境运行时动态 import，导致 Vite chunk 相对路径按 `https://115.com/assets/*` 请求
- `src/content/video-page.ts` 不应运行时 `await import('../player/player')`，应保持顶层静态 import
- 若再次看到 `https://115.com/assets/player-*.js`、`player-playlist-cache-*.js`、`m3u8-parser-*.js`，优先复查播放器启动链是否回归动态 import

### 以下方法已验证不治本

- 只禁用进度条预览图
- 只禁用播放列表缩略图
- 只把 `hls.ts` 改为静态导入
- 只清浏览器缓存或只刷新扩展

### 缩略图功能恢复边界

- 不要恢复运行时 `import('../../lib/videoThumbnail')`
- `hover-preview-session.ts` 应顶层静态导入 `getTimelineCovers / getVideoCoverAt / getVideoCovers`
- `overlay-playlist.ts` 应顶层静态导入 `getVideoCovers`，不要在 `lazyLoadPlaylistCovers()` 内动态 import
- `THUMBNAIL_PREVIEW_ENABLED` 和 `PLAYLIST_COVER_FEATURE_ENABLED` 可开启，但前提是不能重新引入运行时动态导入
- 播放列表封面已按上述方式恢复，并通过 `pnpm build`、`pnpm test` 与用户实测

### blob 错误不要和 chunk 404 混为一谈

- `blob:https://115.com/... net::ERR_FILE_NOT_FOUND` 来源是缩略图/VTT 对象 URL 生命周期，不是 `/assets/*` chunk 路径错误
- 缩略图 UI 应使用稳定 `data:` 图片地址；缓存读取需过滤 `blob:` 等非稳定地址
- 后续如果再出现 blob 错误，优先检查是否恢复了 VTT blob track 或让 `blob:` 进入 `HoverCover.imgUrl`

## 文件写入风险

- 修改播放器核心文件前必须先读当前文件内容
- 大文件优先小范围替换，避免整文件重写造成截断
