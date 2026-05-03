---
alwaysApply: false
description: 修改播放器核心链路、播放列表、画质、播放记忆或切换逻辑时使用此规则。
globs:
  - src/player/**/*.ts
  - src/player/**/*.css
  - src/player/**/*.html
---
# 播放器规则

- 修改前优先查看 `docs/runbooks/player.md` 和 `docs/AI-HANDOFF.md`
- 优先复用现有 `src/player/core/*` 模块，不把逻辑塞回大文件
- 先判断是 UI 问题、状态问题、播放源问题还是消息问题
- 连续两次补丁仍不稳时，回到底层设计重看
- 重点回查：打开播放、画质切换、播放记忆、自动下一集、手动上下集、播放列表显隐、移动文件
- 如果只是播放器样式或页面结构小改，保持小改，不要误扩大到整条播放器链路重构
