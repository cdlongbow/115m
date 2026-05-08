# 技术决策记忆

## 用途

- 记录长期有效的技术决策、模块边界和维护约定
- 不记录工具迁移、历史流水账或已废弃入口

## 规则与记忆边界

- `.trae/rules/project-baseline.md` 是唯一始终生效规则入口，保持短规则
- 任务型规则按需保留，例如发布、提交信息等，不做 alwaysApply
- `.trae/memory/*.md` 只记录会影响后续工作的项目级记忆，不放硬规则
- `docs/` 放项目说明、模块地图、runbook，不放强制执行规则
- 同一条规则不要在多个地方维护不同版本

## Chrome 扩展加载边界

- 页面早期接管脚本 `public/video-page-early.js` 只负责同步写入最小播放器壳
- `public/video-page-early.js` 不应读取 Vite manifest，不应动态 import 构建产物
- `src/content/video-page.ts` 不应运行时动态 import `../player/player`
- 涉及 content script、页面上下文、动态 import、Vite chunk 时，先确认执行环境和构建产物路径

## 播放器功能边界

- 缩略图功能必须与主播放链隔离，不能影响播放器初始化、播放源解析、播放列表主功能
- 播放列表是播放器右侧外置面板，不应覆盖视频或遮挡播放器右侧功能区
- 播放列表切换视频时，不能复用旧视频的 hover preview session、旧缩略图异步结果或旧尺寸状态
- 播放进度记忆以 115 原生 history 接口为准，本地 playHistory 代码保留但默认不参与读写
- 播放历史写入需要合并快速拖动/点击，只记录最后一次有效进度，避免高频写入
