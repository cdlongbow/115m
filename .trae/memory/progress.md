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
  - 已确认并修复第二层启动链问题：`src/content/video-page.ts` 不应运行时 `await import('../player/player')`，应使用顶层静态 import
  - 修复后仍有 `videoThumbnail / player-playlist-cache / m3u8-parser` 相关 404，问题已收敛到缩略图子系统
  - 已隔离播放列表缩略图入口：`src/player/core/overlay-playlist.ts` 中 `PLAYLIST_COVER_FEATURE_ENABLED = false`
  - 已隔离进度条 hover preview 入口：`src/player/core/hover-preview.ts` 中 `PREVIEW_FEATURE_ENABLED = false`
  - 在两个入口都关闭后，如果 404 仍存在，下一步优先处理 `src/player/player.ts` 中 `primeThumbnailSourceUrl` 动态导入入口

## 最近验证

- 关闭播放列表缩略图入口后，`pnpm build` 成功，`pnpm test` 成功
- 关闭 hover preview 入口后，`pnpm build` 成功，`pnpm test` 成功

## 下一步建议

1. 让用户刷新扩展和播放器页，确认关闭两个缩略图入口后是否仍有：
   - `getVideoCovers 开始`
   - `/assets/videoThumbnail-*.js`
   - `/assets/player-playlist-cache-*.js`
   - `/assets/m3u8-parser-*.js`
2. 如果仍有，优先移除或隔离 `src/player/player.ts` 的 `primeThumbnailSourceUrl` 入口
3. 每完成一个隔离结论，同步更新 `pitfalls.md` 与本文件
