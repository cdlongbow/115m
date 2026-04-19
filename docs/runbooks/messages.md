# Messages Runbook

适用场景：

- 新增或修改 `chrome.runtime` 消息
- 排查前台、后台、播放器之间的消息链路

## 默认原则

- 消息结构先改 `src/shared/messages.ts`
- 不允许在业务文件里裸写一套新的消息结构
- 后台负责路由和协调，业务能力尽量落回对应模块

## 基本链路

1. 在 `src/shared/messages.ts` 定义或更新消息
2. 在 `src/background/index.ts` 接入入口
3. 在 `src/background/handlers.ts` 或对应模块实现处理
4. 在调用侧接入并验证返回结构

## 常见落点

- 消息协议：`src/shared/messages.ts`
- 后台入口：`src/background/index.ts`
- 后台处理：`src/background/handlers.ts`
- 播放器调用：`src/player/core/player-api.ts`
- 页面相关调用：`src/content/*`

## 修改后检查

- 消息字段名是否统一
- 调用侧和处理侧是否同步更新
- 是否影响播放器核心链路或 `115` 页面能力
- 涉及逻辑时执行 `pnpm test`
- 执行 `pnpm build`
