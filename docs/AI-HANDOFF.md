# AI-HANDOFF

适用场景：

- 需要快速理解项目结构
- 判断需求应该落到哪个模块
- 接手播放器、115 页面能力或后台消息链路

## 接手顺序

1. `.trae/rules/project-baseline.md`
2. 本文档
3. 需求相关规则或 runbook
4. 需求相关模块本身

## 模块地图

### `src/background/`

- 后台消息入口和协调
- 入口：`index.ts`
- 处理：`handlers.ts`

### `src/platform/115/`

- `115` 页面主世界能力和文件动作
- 主世界调用：`main-world.ts`
- 文件动作：`file-actions.ts`

涉及页面上下文对象、列表刷新、文件移动、删除同步时，优先看这里。

### `src/player/core/`

- `player-services.ts`：播放源、面包屑、播放列表整理
- `player-switch.ts`：切换视频与 URL 更新
- `player-navigation.ts`：上一集、下一集、结束后自动下一集
- `player-quality.ts`：画质控件
- `overlay-header.ts`：顶部区域
- `overlay-playlist.ts`：播放列表
- `history.ts`：播放记忆
- `player-api.ts`：播放器相关后台消息调用

### `src/content/`

- `115` 页面内容脚本
- 包含列表页预览、下载拦截、页面消息处理

### `src/shared/`

- 共享协议层
- 消息定义入口：`messages.ts`

## 典型任务落点

- 播放器切换、播放列表、画质：`src/player/core/*`
- `115` 页面主世界调用：`src/platform/115/*`
- 后台消息：`src/shared/messages.ts`、`src/background/*`

## 文档路由

- 消息链路：`docs/runbooks/messages.md`
- 播放器：`docs/runbooks/player.md`
