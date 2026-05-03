# Player Runbook

适用场景：

- 需要判断播放器相关代码落点时
- 需要完整检查播放器主链路时

## 常见落点

- 播放源与列表整理：`src/player/core/player-services.ts`
- 视频切换：`src/player/core/player-switch.ts`
- 上一集、下一集、自动连播：`src/player/core/player-navigation.ts`
- 画质逻辑：`src/player/core/player-quality.ts`
- 顶部区域：`src/player/core/overlay-header.ts`
- 右侧播放列表：`src/player/core/overlay-playlist.ts`
- 播放记忆：`src/player/core/history.ts`
- 播放器侧消息调用：`src/player/core/player-api.ts`

## 主链路检查

- 能正常打开播放
- 画质切换不回退
- 播放记忆正常
- 需要时检查自动下一集、手动上下集、播放列表显隐、移动文件
