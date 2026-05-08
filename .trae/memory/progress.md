# 项目进度记忆

## 用途

- 记录当前任务进度、排查中断点、最近验证结果
- 新对话或上下文丢失后，先看本文件恢复现场
- 只记录会影响后续继续工作的事实，不写流水账

## 当前播放器 404 排查进度

- 已移除全局 MCP 记忆器，项目记忆改为 `.trae/memory/*.md` 随 Git 同步
- 已将 `AGENTS.md` 的核心协作入口合并进 `.trae/rules/project-baseline.md`
- 播放器页 `/assets/*` 404 排查当前状态：
  - 已确认并修复第一层启动链问题：`public/video-page-early.js` 不应读取 `.vite/manifest.json` 后动态 `import(video-page)`
  - 已确认并修复第二层启动链问题：`src/content/video-page.ts` 不应运行时 `await import('../player/player')`，应使用顶层静态 import；本轮发现该入口在当前文件中回归，已再次改回顶层静态 import
  - 修复后仍有 `videoThumbnail / player-playlist-cache / m3u8-parser` 相关 404，问题已收敛到缩略图子系统
  - 已隔离播放列表缩略图入口：`src/player/core/overlay-playlist.ts` 中 `PLAYLIST_COVER_FEATURE_ENABLED = false`
  - 进度条 hover preview 已按长期方案恢复：`src/player/core/hover-preview-session.ts` 静态导入 `../../lib/videoThumbnail`，不再运行时动态 `import('../../lib/videoThumbnail')`
  - 已移除 `src/player/player.ts` 中 `setupProgressHoverPreview()` 对 `primeThumbnailSourceUrl` 的动态导入预热入口
  - 播放列表封面暂不恢复，避免重新引入列表侧动态缩略图链路
  - 下一步让用户刷新扩展和播放器页，确认控制台是否还出现 `/assets/videoThumbnail-*.js`、`/assets/m3u8-parser-*.js`、`/assets/player-playlist-cache-*.js`，并确认进度条 hover 预览图是否恢复

## 播放器默认无损与预览图状态

- MKV 手动切无损可播放但下次默认回到 `115原画` 的根因：`canUseNativeUltraSource()` 未把 `mkv` 视为可走 native ultra，导致已记住 `无损` 偏好时仍回退到 HLS 9999 并显示 `115原画`
- 已将 `mkv` 加入 native ultra 允许列表，并更新 `native-playback.test.ts`
- 为避免 404，缩略图生成被关闭后，hover 预览 UI 不能继续显示加载中；已让 `HoverPreviewController.setup()` 在 `THUMBNAIL_PREVIEW_ENABLED = false` 时直接返回
- 长期恢复进度条预览图方案：恢复 `THUMBNAIL_PREVIEW_ENABLED = true`，但将 `hover-preview-session.ts` 对 `videoThumbnail` 的依赖改为顶层静态 import；播放列表封面仍保持关闭

## 最近验证

- 关闭播放列表缩略图入口后，`pnpm build` 成功，`pnpm test` 成功
- 关闭 hover preview 入口后，`pnpm build` 成功，`pnpm test` 成功
- 移除 `primeThumbnailSourceUrl` 动态导入预热入口并隔离 hover preview 缩略图生成后，`pnpm build` 成功，`pnpm test` 成功
- 再次修复 `src/content/video-page.ts` 动态导入播放器入口回归后，`pnpm build` 成功，`pnpm test` 成功
- 修复 MKV 默认无损与预览图加载中残留后，`pnpm build` 成功，`pnpm test` 成功
- 按静态导入方案恢复进度条预览图后，`pnpm build` 成功，`pnpm test` 成功
- 修复预览图 hover 滑动时 blob URL 失效报错后，`pnpm build` 成功，`pnpm test` 成功
- 移除 `artplayerPluginThumbnail:update` 的 VTT blob track，仅保留自定义 hover 预览 UI 后，`pnpm build` 成功，`pnpm test` 成功
- 升级缩略图缓存到 `v4` 并过滤旧缓存中的 `blob:` 图片地址后，`pnpm build` 成功，`pnpm test` 成功

## 下一步建议

1. 让用户刷新扩展和播放器页，确认是否仍有：
   - `getVideoCovers 开始`
   - `/assets/videoThumbnail-*.js`
   - `/assets/player-playlist-cache-*.js`
   - `/assets/m3u8-parser-*.js`
2. 如果仍有，需要继续查是否存在非播放器页或 content 侧入口触发 `videoThumbnail` 动态导入
3. 每完成一个隔离结论，同步更新 `pitfalls.md` 与本文件
