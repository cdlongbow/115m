---
alwaysApply: false
description: 整理项目文档、规则、偏好或 runbook 结构时使用此规则。
globs:
  - AGENTS.md
  - docs/**/*.md
  - .trae/rules/*.md
---
# 文档与规则整理规则

- 先判断内容归属，再决定写入 `AGENTS.md`、`docs/*` 或 `.trae/rules/*`
- `AGENTS.md` 只保留项目核心总纲，不写模块细节地图、低频流程或一次性需求
- `docs/AI-PREFERENCES.md` 只保留长期稳定偏好或长期产品约定
- `docs/AI-HANDOFF.md` 只保留项目地图、模块职责、典型任务落点、接手顺序
- `docs/runbooks/*.md` 只保留固定流程或确实复杂、容易遗漏的步骤清单
- `.trae/rules/**/*.md` 只保留需要让 Trae 自动套用的规则
- 同一条规则不要在多个地方维护不同版本
- 能直接规则化的内容，不单独再做文档路由
- 规则文案尽量短、能直接执行，完整步骤只留给复杂场景的 runbook
- 若内容已成为项目公共铁律，迁移到 `AGENTS.md`
- 若内容只在特定流程有效，迁移到对应 runbook
