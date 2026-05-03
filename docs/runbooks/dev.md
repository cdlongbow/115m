# Dev Runbook

适用场景：

- 本地开发前检查环境
- 排查版本号、构建产物、发布前自检这类基础问题

## 默认原则

- 本地开发默认只加载 `dist/`
- 代码改动后先执行 `pnpm build`，再去扩展页点重新加载
- 版本号以 `package.json` 为主，`pnpm build` 前会自动同步到 `manifest.json`
- 发布前先执行检查脚本，不靠手动记忆步骤

## 常用命令

```bash
pnpm doctor
pnpm test
pnpm build
pnpm zip
pnpm release:check
```

## 命令说明

- `pnpm doctor`：检查版本号同步、关键 runbook、workflow、git 和 gh 状态
- `pnpm test`：跑测试
- `pnpm build`：构建扩展，并先同步 `manifest` 版本号
- `pnpm zip`：构建并打包到 `release/`
- `pnpm release:check`：检查版本、zip 和 gh 登录状态，确认是否可发 Release

## 常见问题

1. 扩展页版本号不对
   - 先执行 `pnpm build`
   - 再去 `chrome://extensions/` 里点重新加载
   - 如果仍不对，执行 `pnpm doctor` 看 `package.json` 与 `manifest.json` 是否一致

2. 代码改了但浏览器没变化
   - 确认加载的是 `dist/`，不是仓库根目录
   - 重新执行 `pnpm build`
   - 在扩展页点重新加载

3. GitHub Release 发不出去
   - 先执行 `pnpm release:check`
   - 如果提示 `gh` 失效，重新执行 `gh auth login`

4. Telegram 发布通知失败
   - 检查仓库 Secrets：`TG_BOT_TOKEN`、`TG_CHAT_ID`
   - 检查机器人是否还在群里，且有置顶权限

## 日常流程

1. 改代码
2. 执行 `pnpm test`（需要时）
3. 执行 `pnpm build`
4. 去扩展页重新加载并实测
5. 准备发布时执行 `pnpm zip`
6. 准备发布前执行 `pnpm release:check`
