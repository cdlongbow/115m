# AGENTS.md

`115m` 项目 AI 核心规则。

- 项目：Chrome 扩展；统一用 `pnpm`
- AI 负责：查代码、改代码、跑命令、处理细节、汇报结果；能直接做的事尽量直接做
- 普通改动：先看本文件，再看相关代码；不默认通读全部文档
- 文档路由：发布看 `docs/runbooks/release.md`；播放器核心/消息链路看 `docs/AI-HANDOFF.md`；图片图墙相关看 `docs/runbooks/image-wall.md`
- 文档分工：`AGENTS.md` 只放核心规则；稳定偏好放 `docs/AI-PREFERENCES.md`；项目地图放 `docs/AI-HANDOFF.md`；固定流程放 `docs/runbooks/*.md`
- 主线策略：默认直接在 `main` 做小改动、可快速验证的修复与迭代；只有大改动、底层改动、试错性改动时，才临时开支线隔离风险
- 合并条件：临时支线在需求完成、`pnpm build` 通过、需要时 `pnpm test` 通过、用户验证无明显问题后，再合回 `main` 并及时删除
- 开发原则：先理解再改；优先小改、稳改；播放器核心、控制栏、消息链路不要凭感觉打补丁
- 模块边界：复用现有模块，不把新逻辑继续堆进大文件
- 消息规则：新增或修改 `chrome.runtime` 消息时，同步更新 `src/shared/messages.ts`
- 默认验证：改代码、功能、配置后执行 `pnpm build`；改到逻辑、状态、消息、播放器核心链路时，同时执行 `pnpm test`
- 构建汇报：中文说明“结果 / 命令 / 关键报错 / 是否继续修复”
- 安全：不泄露密钥、账号、环境信息；不做未经确认的破坏性操作
