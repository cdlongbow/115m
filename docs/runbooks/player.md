# Player Runbook

适用场景：

- 修改播放器核心链路
- 修改播放列表、画质、播放记忆、切换逻辑
- 判断播放器相关代码该落到哪个模块

## 默认原则

- 先复用现有 `src/player/core/*` 模块，不把逻辑塞回大文件
- 先判断是底座问题、扩展点问题还是单点逻辑问题
- 连续两次补丁仍不稳时，回到底层设计重看

## 常见落点

- 播放源与列表整理：`src/player/core/player-services.ts`
- 视频切换：`src/player/core/player-switch.ts`
- 上一集、下一集、自动连播：`src/player/core/player-navigation.ts`
- 画质逻辑：`src/player/core/player-quality.ts`
- 顶部区域：`src/player/core/overlay-header.ts`
- 右侧播放列表：`src/player/core/overlay-playlist.ts`
- 播放记忆：`src/player/core/history.ts`
- 播放器侧消息调用：`src/player/core/player-api.ts`

## 开发前判断

1. 这次是 UI 问题、状态问题、播放源问题，还是消息问题
2. 现有模块能否承接，是否真的需要新文件
3. 是否会影响主链路：打开播放、画质切换、播放记忆、移动文件

## 开发后默认检查

- 能正常打开播放
- 画质切换不回退
- 播放记忆正常
- 需要时检查自动下一集、手动上下集、播放列表显隐、移动文件
- 执行 `pnpm test`
- 执行 `pnpm build`
