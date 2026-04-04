# AGENTS.md

本文件定义本仓库中 AI 编码代理的工作规则。

## 项目概况

- 项目名：`115m-extension`
- 类型：Chrome 扩展（Manifest V3）
- 技术栈：TypeScript + Vite + Vitest + pnpm
- 关键目录：
  - `src/content/`（内容脚本）
  - `src/player/`（独立播放器页面）
  - `src/shared/`（共享逻辑与消息）

## 强制工作流

当 AI 修改代码时，必须完成以下步骤：

1. 完成用户要求的代码修改。
2. 自动执行构建：`pnpm build`。
3. 用自然语言向用户报告构建结果。

除非用户明确要求不执行构建，否则不得跳过第 2 步。

## 构建汇报规则

执行 `pnpm build` 后，回复中必须包含：

- `Build result`：success 或 failed
- `Command`：`pnpm build`
- 若失败：首个关键报错及文件路径（如可定位）
- 若失败：是否尝试修复（Yes/No）

建议格式：

- Build result: Success
- Command: `pnpm build`

或

- Build result: Failed
- Command: `pnpm build`
- Key error: `<error summary>`
- Location: `<path:line>`
- Attempted fix: Yes/No

## 命令策略

- 统一使用 `pnpm`（禁止使用 npm/yarn）。
- 优先命令：
  - `pnpm test`
  - `pnpm build`
  - `pnpm zip`

## 记忆规则（MCP）

- 首次对话时，主动使用 MCP 记忆器回忆该项目的用户偏好。
- 如果上下文已经清楚，不需要重复回忆。
- 如果上下文不清楚，先回忆再决策。

## 用户偏好

- 用户偏好使用中文沟通与回复。

## 文档语言

- 本项目新增或修改的说明文档优先使用中文。

## 安全规则

- 未经用户明确要求，不得执行破坏性 Git 命令。
- 不得暴露本地文件或环境中的密钥与敏感信息。
- 若遇到模型不支持图片输入（例如 `Cannot read "image.png"`），必须明确告知用户该限制。
