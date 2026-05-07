# 技术决策记忆

## 用途

- 记录长期有效的技术决策、模块边界和维护约定
- 后续 AI 修改项目时必须遵守，除非用户明确要求改变

## 项目内记忆方案

- 已移除全局 MCP 记忆器
- 项目记忆统一放在 `.trae/memory/*.md`
- `.trae/memory/` 文件随 Git 同步，作为项目级可备份记忆
- `.trae/rules/project-baseline.md` 是唯一始终生效规则入口
- AI 在确认根因、无效方案、长期偏好、关键进度后，必须主动更新 `.trae/memory/*.md`

## 规则与文档结构决策

- `AGENTS.md` 已删除，不再作为 AI 入口
- 当前保持一个始终生效规则：`.trae/rules/project-baseline.md`
- 不拆多个始终生效规则，避免规则冲突、重复和上下文膨胀
- `.trae/rules/project-baseline.md` 保持短规则，只放必须遵守的核心约束和智能联动入口
- 任务型规则按需保留，例如发布、提交信息等，不做 alwaysApply
- `.trae/memory/*.md` 放项目 AI 记忆，不放硬规则
- `docs/` 放项目说明、模块地图、runbook，不放强制执行规则
- `README.md` 面向用户，不承担 AI 协作规则

## Chrome 扩展加载边界

- 页面早期接管脚本 `public/video-page-early.js` 只负责同步写入最小播放器壳
- `public/video-page-early.js` 不应读取 Vite manifest，不应动态 import 构建产物
- `src/content/video-page.ts` 不应运行时动态 import `../player/player`
- 涉及 content script、页面上下文、动态 import、Vite chunk 时，必须先看 `dist/.vite/manifest.json` 验证依赖关系

## 播放器缩略图方向

- 缩略图功能需要与主播放链隔离
- 缩略图优化不能影响播放器初始化、播放源解析、播放列表主功能
- 处理缩略图 404 时，按入口隔离：
  1. 播放列表缩略图入口
  2. 进度条 hover preview 入口
  3. `player.ts` 中的 `primeThumbnailSourceUrl` 预热入口
- 禁止为消除 404 盲目把大依赖静态并入主播放链，除非已验证不会导致初始化卡住或测试环境失败
