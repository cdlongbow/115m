# AI-HANDOFF

这份文档给后续接手 `115m` 项目的 AI 使用。

目标只有两个：

- 快速知道项目现在已经整理到什么程度
- 新需求来了，先知道该改哪一层，不要再回到补丁式开发

## 先看什么

接手时建议按这个顺序读：

1. `AGENTS.md`
2. `README.md`
3. 本文档
4. `src/shared/messages.ts`
5. 需求相关模块本身

## 项目现在的基本判断

- 项目类型：Chrome 扩展
- 包管理：`pnpm`
- 当前状态：主链路稳定，可持续开发，不应再默认做大规模重构
- 当前开发方式：用户提需求和实测，AI 负责实现、验证、整理细节

这个项目已经做过一轮底座收口。

不要把它当成“还没整理的旧项目”去重新推倒。

## 目录怎么理解

### `src/background/`

负责扩展后台消息入口和协调。

- `index.ts`：后台总消息入口
- `handlers.ts`：后台具体处理动作
- `history-store.ts`：播放历史存储

原则：

- 后台负责消息路由和协调
- 不要把大量 115 页面注入代码重新塞回这里

### `src/platform/115/`

这是 115 页面相关能力的固定落点。

- `main-world.ts`：115 页面主世界执行、tab 查询、主世界 fetch
- `file-actions.ts`：115 页面里的文件动作、列表刷新、删除同步等

原则：

- 只要涉及 `chrome.scripting.executeScript`
- 只要涉及 115 页面上下文对象
- 只要涉及列表刷新、文件移动、删除、页面主世界请求

优先放这里，不要散写到业务层。

### `src/player/`

独立播放器页面。

- `player.ts`：播放器装配、生命周期、总调度
- `core/`：播放器拆分后的能力模块

目前约定：

- `player.ts` 不继续堆业务细节
- `overlay.ts` 不继续堆接口请求和运行时杂项

### `src/player/core/`

这是后续播放器新增逻辑最常用的区域。

现有模块职责：

- `player-services.ts`：播放源、面包屑、播放列表数据整理
- `player-switch.ts`：切换视频时的元信息和 URL 更新
- `player-navigation.ts`：上一集、下一集、结束后自动下一集辅助逻辑
- `player-quality.ts`：画质控件构造和更新
- `player-center-controls.ts`：中间播放控制区 UI 辅助逻辑
- `overlay-playlist.ts`：播放列表渲染、交互、封面懒加载
- `overlay-header.ts`：顶部头部 scaffold 和按钮构造
- `history.ts`：播放记忆和相关辅助逻辑
- `source.ts`：播放器播放源获取入口
- `player-api.ts`：播放器相关后台消息调用
- `move-dialog.ts` / `move-dialog-api.ts`：移动弹窗 UI 与数据调用

如果新增播放器功能，先判断是否能挂到这些现有模块。

### `src/content/`

115 页面内容脚本。

- 列表页预览
- 下载拦截
- 页面消息处理

原则：

- 页面增强逻辑放这里
- 不要把播放器专属逻辑再放回内容脚本

### `src/shared/`

共享协议层。

- `messages.ts`：消息定义

原则：

- 新增或修改 `chrome.runtime` 消息，必须先改这里

### `src/lib/`

通用能力。

- `pro-api.ts`：Pro API / Web API 下载与播放源统一策略
- `videoThumbnail.ts`：缩略图提取
- 其他接口、工具、解码能力

原则：

- 同类下载策略、鉴权策略、降级策略不要重复在多个业务文件里再写一份

## 现在最重要的开发规则

1. 不要在 `main` 上直接做重构、试验性改动
2. 新需求优先复用现有模块，不要直接把逻辑塞回 `player.ts`、`overlay.ts`、`background/handlers.ts`
3. 涉及 115 页面主世界能力时，优先落到 `src/platform/115/*`
4. 涉及消息协议时，先改 `src/shared/messages.ts`
5. 同一类下载/降级/播放源策略不要重复实现
6. 改播放器核心链路后，默认跑 `pnpm test` 和 `pnpm build`
7. 用户实测通过前，不要判断为可合并主线
8. 主链路稳定后，不要为了“更干净”继续空转大重构

## 用户不懂代码时，AI 应该怎么工作

这个项目是纯 AI 协作开发为主。

所以后续 AI 要注意：

- 不要只讲术语
- 先给结论，再说影响
- 说“该不该动”“现在是否稳定”“风险是不是马上会炸”
- 不要把用户需要自己做的一堆零碎技术操作丢回去

## 接手时的快速检查清单

开始前先看：

1. 当前分支是不是 `main`
2. 工作区是不是干净
3. 最近一次改动是不是播放器主链路
4. `AGENTS.md` 是否有新增规则
5. 新需求属于哪一层：`platform/115`、`background`、`content`、`player/core`、`lib`

## 典型落点参考

### 要加 115 页面主世界调用

优先看：

- `src/platform/115/main-world.ts`
- `src/platform/115/file-actions.ts`

### 要加播放器切换、播放列表、画质逻辑

优先看：

- `src/player/core/player-services.ts`
- `src/player/core/player-switch.ts`
- `src/player/core/player-navigation.ts`
- `src/player/core/player-quality.ts`

### 要改播放器顶部或右侧列表 UI

优先看：

- `src/player/core/overlay.ts`
- `src/player/core/overlay-header.ts`
- `src/player/core/overlay-playlist.ts`

### 要加后台消息

优先看：

- `src/shared/messages.ts`
- `src/background/index.ts`
- `src/background/handlers.ts`

## 不建议现在做的事

- 不要为了形式上的“更优雅”继续拆很多文件
- 不要把已经稳定的主链路再推倒重做
- 不要把平台层逻辑重新打散回业务层

## 一句话交接

这个项目现在已经从“容易补丁化”进入“可持续开发”状态。

后续 AI 的核心任务不是继续大拆，而是：

- 按层落代码
- 守住主链路
- 用真实需求驱动演进
