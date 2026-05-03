# AGENTS.md

`115m` 项目 AI 核心总纲。

## 项目定位

- 项目类型：Chrome 扩展
- 包管理器：统一使用 `pnpm`
- 默认开发主线：`main`

## AI 工作方式

- AI 负责：查代码、改代码、跑命令、处理细节、汇报结果；能直接做的事尽量直接做
- 普通改动：先看当前文件，再看相关代码；不默认通读全部文档
- 先理解再改；优先小改、稳改
- 仅修改当前需求涉及的功能与边界，不自行扩展需求

## 改动边界

- 改什么功能就只改什么功能
- 未被当前需求明确要求、且已稳定的功能，禁止顺手改动、联动改样式、重构或行为调整
- 如确需影响其他稳定功能，必须先单独说明原因并获得确认
- 播放器核心、控制栏、消息链路不要凭感觉打补丁

## 隔离与模块原则

- 涉及现有稳定功能附近的改动，必须先检查模块、样式、状态和消息边界是否已隔离
- 如果存在影响其他功能的风险，先完成隔离再继续功能改动
- 禁止在未隔离情况下把多个功能堆在同一改动里一起调整
- 复用现有模块，不把新逻辑继续堆进大文件

## 协议与验证

- 新增或修改 `chrome.runtime` 消息时，同步更新 `src/shared/messages.ts`
- 改代码、功能、配置后执行 `pnpm build`
- 改到逻辑、状态、消息、播放器核心链路时，同时执行 `pnpm test`
- 构建汇报使用中文，包含：结果 / 命令 / 关键报错 / 是否继续修复

## 分支与合并

- 默认直接在 `main` 做小改动、可快速验证的修复与迭代
- 只有大改动、底层改动、试错性改动时，才临时开支线隔离风险
- 临时支线在需求完成、`pnpm build` 通过、需要时 `pnpm test` 通过、用户验证无明显问题后，再合回 `main` 并及时删除

## 文档与规则路由

- 核心规则：`AGENTS.md`
- 稳定偏好：`docs/AI-PREFERENCES.md`
- 项目地图与模块接手：`docs/AI-HANDOFF.md`
- 文档整理规范：`docs/runbooks/docs.md`
- Trae 自动规则：`.trae/rules/*.md`
- 项目核心自动规则：`.trae/rules/project-baseline.md`
- 发布自动规则：`.trae/rules/release.md`
- 消息链路自动规则：`.trae/rules/messages.md`
- 播放器自动规则：`.trae/rules/player.md`
- 文档整理自动规则：`.trae/rules/docs-maintenance.md`
- Git 提交信息自动规则：`.trae/rules/git-commit-message.md`
- 消息链路 / 播放器：`docs/runbooks/messages.md`、`docs/runbooks/player.md`
- 图片图墙：`docs/runbooks/image-wall.md`

## 安全

- 不泄露密钥、账号、环境信息
- 不做未经确认的破坏性操作
