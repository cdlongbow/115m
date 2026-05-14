# 项目进度记忆

## 用途

- 只记录会影响后续继续工作的进度、验证结果和中断点
- 不记录流水账、工具迁移、已废弃协作方式等低价值信息

## 播放器当前状态

- 播放器页 `/assets/*` 404 的关键边界：content / page 启动链不能运行时动态 import 播放器入口；`src/content/video-page.ts` 应保持顶层静态 import 播放器模块
- MKV 默认无损已修复：`canUseNativeUltraSource()` 已允许 `mkv` 走 native ultra
- 无损原文件若出画但无音频解码，会自动回退到 115 原画 HLS，以恢复 m3u8 主清单里的多音轨
- 进度条预览图已恢复：`hover-preview-session.ts` 顶层静态导入 `videoThumbnail` 相关方法，不能恢复运行时动态 import
- 播放列表封面已恢复：`overlay-playlist.ts` 顶层静态导入 `getVideoCovers`，`PLAYLIST_COVER_FEATURE_ENABLED = true`
- 缩略图缓存版本为 `v4`，缓存读取会过滤 `blob:` 等非稳定图片地址，UI 使用稳定 `data:` 图片地址
- 播放进度记忆已接入 115 原生 history 接口；本地 playHistory 默认关闭但代码保留
- 播放列表为右侧外置面板，不遮挡视频；用户确认播放列表打开时移动/删除正常，进度条预览图比例正常
- 移动弹窗：默认进入最近一次移动目录；确认按钮固定为“移动到此”；移动成功后当前视频继续播放但从播放列表移除

## 最近验证

- 近期播放器、播放列表、预览图、播放记忆、移动弹窗相关改动均已通过 `pnpm test` 与 `pnpm build`

## 发布记录

- 2026-05-08：已发布 `v1.5.0`
  - GitHub Release：https://github.com/qh775885/115m/releases/tag/v1.5.0
  - 发布包：`release/115m-v1.5.0.zip`
  - 验证：`pnpm test`、`pnpm build`、`pnpm zip`、`pnpm release:check` 均通过
- 2026-05-08：已发布 `v1.4.0`
  - GitHub Release：https://github.com/qh775885/115m/releases/tag/v1.4.0
  - 发布包：`release/115m-v1.4.0.zip`
  - 验证：`pnpm build`、`pnpm test`、`pnpm zip`、`pnpm release:check` 均通过
