# AI-HANDOFF

适用场景：

- 需要快速理解项目结构
- 判断需求应该落到哪个模块
- 接手播放器、115 页面能力或后台消息链路

## 接手顺序

1. `AGENTS.md`
2. 本文档
3. 需求相关 runbook
4. 需求相关模块本身

## 项目概要

- 项目类型：Chrome 扩展
- 包管理：`pnpm`
- 当前状态：主链路稳定，可持续开发
- 默认策略：按现有模块继续演进，不回到补丁式堆逻辑

## 模块地图

### `src/background/`

- 负责后台消息入口和协调
- 入口：`index.ts`
- 处理：`handlers.ts`
- 存储：`history-store.ts`

### `src/platform/115/`

- 负责 `115` 页面主世界能力和文件动作
- 主世界调用：`main-world.ts`
- 文件动作：`file-actions.ts`

涉及 `chrome.scripting.executeScript`、页面上下文对象、列表刷新、文件移动、删除同步时，优先看这里。

### `src/player/`

- 负责独立播放器页面
- 总装配：`player.ts`
- 主要能力拆分在 `core/`

### `src/player/core/`

- `player-services.ts`：播放源、面包屑、播放列表整理
- `player-switch.ts`：切换视频与 URL 更新
- `player-navigation.ts`：上一集、下一集、结束后自动下一集
- `player-quality.ts`：画质控件
- `overlay-header.ts`：顶部区域
- `overlay-playlist.ts`：播放列表
- `history.ts`：播放记忆
- `source.ts`：播放源获取入口
- `player-api.ts`：播放器相关后台消息调用
- `move-dialog.ts` / `move-dialog-api.ts`：移动文件弹窗

### `src/content/`

- 负责 `115` 页面内容脚本
- 包含列表页预览、下载拦截、页面消息处理

### `src/shared/`

- 共享协议层
- 消息定义入口：`messages.ts`

### `src/lib/`

- 通用能力
- 包含接口访问、缩略图提取、下载与播放源策略

## 典型任务落点

### 播放器切换、播放列表、画质

- `src/player/core/player-services.ts`
- `src/player/core/player-switch.ts`
- `src/player/core/player-navigation.ts`
- `src/player/core/player-quality.ts`

### 播放器顶部和右侧列表 UI

- `src/player/core/overlay-header.ts`
- `src/player/core/overlay-playlist.ts`

### `115` 页面主世界调用

- `src/platform/115/main-world.ts`
- `src/platform/115/file-actions.ts`

### 后台消息

- `src/shared/messages.ts`
- `src/background/index.ts`
- `src/background/handlers.ts`

## 接手时先确认

1. 当前分支是不是 `main`
2. 这次需求属于哪一层
3. 是否改到播放器核心或消息链路
4. 是否需要同步更新 `src/shared/messages.ts`

## 文档路由

- 开发与构建验证：`docs/runbooks/dev.md`
- 消息链路：`docs/runbooks/messages.md`
- 播放器：`docs/runbooks/player.md`
- 发布：`docs/runbooks/release.md`
- 图片图墙：`docs/runbooks/image-wall.md`
