# 文档与规则维护规范

适用场景：

- 整理项目文档结构时
- 判断内容应该写入哪里时
- 发现规则、偏好、流程或项目地图混写时

## 分层原则

- `AGENTS.md`：只放项目总纲、协作方式和统一入口
- `docs/AI-PREFERENCES.md`：只放长期稳定偏好
- `docs/AI-HANDOFF.md`：只放项目地图、模块接手与需求落点
- `docs/runbooks/*.md`：只放固定流程或确实复杂、容易遗漏的步骤清单
- `.trae/rules/**/*.md`：只放给 Trae 自动生效的规则

## 当前项目最小结构

- `README.md`：项目简介、功能概览、基础命令、本地使用
- `AGENTS.md`：项目总纲、协作方式、规则入口
- `docs/AI-HANDOFF.md`：项目地图与典型任务落点
- `docs/AI-PREFERENCES.md`：长期稳定偏好
- `docs/runbooks/messages.md`：消息链路索引
- `docs/runbooks/player.md`：播放器落点与主链路检查
- `.trae/rules/*.md`：Trae 自动规则

## 当前项目规则设计

- `project-baseline.md`：始终生效，承载项目级硬规则
- `docs-maintenance.md`：智能生效 + 指定文件生效，用于整理文档、规则、偏好与结构
- `release.md`：智能生效，用于发布与发布说明
- `messages.md`：智能生效 + 指定文件生效，用于消息链路相关文件与任务
- `player.md`：智能生效 + 指定文件生效，用于播放器相关文件与任务
- `git-commit-message.md`：智能生效，用于生成提交信息

## 精简结论

- 能直接由短规则说明清楚的场景，不单独再做文档路由
- 发布只保留 `release.md` 规则，不再保留发布文档
- 基础开发命令与本地使用说明放回 `README.md`
- `messages.md`、`player.md` 保留简短 runbook，仅承载落点索引和必要检查
- `project-baseline.md` 作为项目级硬规则源；`AGENTS.md` 不再重复维护同一套规则
- 规则和文档各自独立有用；文档只在统一入口出现，不作为规则前置依赖

## 写入规则

### 写入 `README.md`

仅收录：

- 项目简介
- 功能概览
- 基础命令
- 本地使用
- 协作文件入口

### 写入 `AGENTS.md`

仅收录：

- 项目定位
- 协作方式
- 文档与规则分工
- 默认加载顺序
- 规则入口
- 安全要求

### 写入 `docs/AI-HANDOFF.md`

仅收录：

- 模块地图
- 典型任务落点
- 必要文档索引

### 写入 `docs/AI-PREFERENCES.md`

仅收录：

- 长期稳定的用户偏好
- 长期稳定的产品交互约定
- 会长期影响后续实现判断的边界

### 写入 `docs/runbooks/*.md`

仅收录：

- 确实复杂、容易遗漏的模块索引
- 必要检查项

### 写入 `.trae/rules/**/*.md`

仅收录：

- 希望 Trae 自动套用的规则
- 与文件类型、任务场景或项目全局相关的规则

## 维护原则

- 新内容先判断归属，再写入对应层
- 同一条规则不要在多个地方重复维护不同版本
- `.trae/rules/` 负责短规则；能规则化就规则化
- 只有复杂且易漏的场景才额外保留 runbook
- 如果内容已升级为项目公共铁律，迁移到 `project-baseline.md`
- 如果内容需要让 Trae 自动生效，迁移到 `.trae/rules/`
