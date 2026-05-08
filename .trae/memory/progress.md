# 项目进度记忆

## 用途

- 只记录会影响后续继续工作的进度、验证结果和中断点
- 不记录流水账、工具迁移、已废弃协作方式等低价值信息

## 播放器状态

- 播放器页 `/assets/*` 404 的关键边界：content / page 启动链不能运行时动态 import 播放器入口；`src/content/video-page.ts` 应保持顶层静态 import 播放器模块
- MKV 默认无损已修复：`canUseNativeUltraSource()` 已允许 `mkv` 走 native ultra
- 进度条预览图已恢复：`hover-preview-session.ts` 顶层静态导入 `videoThumbnail` 相关方法，不能恢复运行时动态 import
- 播放列表封面已恢复：`overlay-playlist.ts` 顶层静态导入 `getVideoCovers`，`PLAYLIST_COVER_FEATURE_ENABLED = true`；用户确认播放列表预览图问题已解决
- 缩略图缓存版本为 `v4`，缓存读取会过滤 `blob:` 等非稳定图片地址，UI 使用稳定 `data:` 图片地址

## 最近验证

- 恢复播放列表封面并移除列表侧 `videoThumbnail` 运行时动态导入后：`pnpm build` 成功，`pnpm test` 成功
- 用户实测：播放列表预览图已正常

## 发布记录

- 2026-05-08：已发布 `v1.4.0`
  - GitHub Release：https://github.com/qh775885/115m/releases/tag/v1.4.0
  - 发布包：`release/115m-v1.4.0.zip`
  - 验证：`pnpm build`、`pnpm test`、`pnpm zip`、`pnpm release:check` 均通过
