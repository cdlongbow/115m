---
alwaysApply: false
description: 发布 GitHub Release、整理发布说明或检查发布流程时使用此规则。
globs:
  - release/*
  - docs/runbooks/release.md
---
# 发布规则

- 发布前先查看 `docs/runbooks/release.md`
- 发布说明默认写给用户看，不写内部重构细节
- 内容优先参考 `项目日志.md`
- 发布说明文件统一放在 `release/` 目录
- 不使用提交列表直接堆砌发布说明
- 若只是修改发布说明文案，不要误扩展到无关代码改动
