# Messages Runbook

适用场景：

- 需要完整梳理消息接入步骤时
- 排查前台、后台、播放器之间的消息链路时

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
