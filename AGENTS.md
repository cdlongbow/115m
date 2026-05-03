# AGENTS.md

`115m` 项目 AI 总纲与路由入口。

## 项目定位

- 项目类型：Chrome 扩展
- 包管理器：统一使用 `pnpm`
- 默认开发主线：`main`

## 使用方式

- 项目级硬规则以 `.trae/rules/project-baseline.md` 为准
- `AGENTS.md` 负责说明协作方式、文档分工和路由入口，不重复维护同一套核心规则
- 普通改动先看当前文件，再按任务加载相关规则、文档和代码

## 文档与规则分工

- `README.md`：项目简介、基础命令、本地使用
- `AGENTS.md`：项目总纲、协作方式、文档路由
- `docs/AI-HANDOFF.md`：项目地图、模块职责、典型任务落点
- `docs/AI-PREFERENCES.md`：长期稳定偏好
- `docs/runbooks/messages.md`：消息链路索引
- `docs/runbooks/player.md`：播放器落点与主链路检查
- `.trae/rules/*.md`：Trae 自动生效规则

## 默认加载顺序

1. `AGENTS.md`
2. 需求相关 `.trae/rules/*.md`
3. `docs/AI-HANDOFF.md`
4. 必要时再看对应 runbook 和目标代码

## 当前规则路由

- 项目核心自动规则：`.trae/rules/project-baseline.md`
- 发布自动规则：`.trae/rules/release.md`
- 消息链路自动规则：`.trae/rules/messages.md`
- 播放器自动规则：`.trae/rules/player.md`
- 文档整理自动规则：`.trae/rules/docs-maintenance.md`
- Git 提交信息自动规则：`.trae/rules/git-commit-message.md`

## 安全

- 不泄露密钥、账号、环境信息
- 不做未经确认的破坏性操作
