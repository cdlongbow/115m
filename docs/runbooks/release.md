# Release Runbook

适用场景：

- 发布 GitHub Release
- 构建并上传 zip
- 编写用户向更新说明

## 默认原则

- 发布说明默认写给用户看，不写内部重构细节
- 内容优先基于本次改动、相关提交和用户可感知变化整理
- 发布说明文件统一放在 `release/` 目录
- 旧版 zip 和旧版发布说明先保留，等有新版发布时再删除旧版

## 默认流程

1. 确认版本号与目标仓库正确
2. 执行 `pnpm build`
3. 执行 `pnpm zip`
4. 确认 `release/` 下最新 zip 存在
5. 在 `release/` 下生成本次版本的发布说明文件
6. 检查 `gh` 是否可用且已登录
7. 编写用户向更新说明
8. 创建或更新 GitHub Release，并上传 zip
9. 如已发布新版，再删除 `release/` 下旧版 zip 和旧版发布说明

## 更新说明写法

- 优先写修了什么体验问题
- 优先写哪些地方更快、更稳、更顺手
- 不写提交名堆砌
- 不写纯内部重构，除非它直接影响用户体验

## 常用命令

```bash
pnpm build
pnpm zip
gh release create vX.Y.Z release/115m-vX.Y.Z.zip --title "vX.Y.Z"
gh release edit vX.Y.Z --notes-file release/release-notes-vX.Y.Z.txt
```

## 发布后检查

- Release 页面是否已生成
- Tag 是否正确
- zip 附件是否已上传
- 发布说明是否为用户向内容
- 发布说明文件是否位于 `release/` 目录
