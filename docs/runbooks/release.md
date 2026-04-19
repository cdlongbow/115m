# Release Runbook

适用场景：

- 发布 GitHub Release
- 构建并上传 zip
- 编写用户向更新说明

## 默认原则

- 发布说明默认写给用户看，不写内部重构细节
- 内容优先参考 `项目日志.md`
- 如果项目日志不够，再结合本次版本区间提交补全用户可感知的变化

## 默认流程

1. 确认版本号与目标仓库正确
2. 执行 `pnpm build`
3. 执行 `pnpm zip`
4. 确认 `release/` 下最新 zip 存在
5. 检查 `gh` 是否可用且已登录
6. 编写用户向更新说明
7. 创建或更新 GitHub Release，并上传 zip

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
gh release edit vX.Y.Z --notes-file <file>
```

## 发布后检查

- Release 页面是否已生成
- Tag 是否正确
- zip 附件是否已上传
- 发布说明是否为用户向内容
