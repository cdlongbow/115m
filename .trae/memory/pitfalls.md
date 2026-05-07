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
  - `hover-preview.ts` 进度条 hover preview 入口已可通过 `PREVIEW_FEATURE_ENABLED = false` 关闭
- 如果这两个入口关闭后仍有 404，优先怀疑：
  - `src/player/player.ts` 的 `primeThumbnailSourceUrl` 动态导入入口

### blob 错误不要和 chunk 404 混为一谈

- `blob:https://115.com/... net::ERR_FILE_NOT_FOUND` 与 chunk 404 不是同一层问题
- blob 错误来源更可能是缩略图生成和 VTT/图片 blob URL 生命周期：
  - `src/lib/videoThumbnail.ts` 使用 `URL.createObjectURL(blob)` 生成图片 URL
  - 旧版 `hover-preview.ts` 曾生成 WEBVTT blob 并通过 `artplayerPluginThumbnail:update` 注入
- 处理 blob 问题前，先确认 chunk 404 的入口已经收敛

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
