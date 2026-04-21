<img width="1040" height="850" alt="QQ20260421-174247" src="https://github.com/user-attachments/assets/f13c87eb-d852-4b23-876d-897cab9b11b2" />
# 115m

`115m` 是一个 115 网盘增强扩展。

主要做两件事：
- 列表页视频预览
- 点击视频后用独立播放器播放

协作规则看 `AGENTS.md`。

## 功能

- 列表页视频预览图
- 未转码视频自动静默加入 VIP 加速队列
- 点击视频进入独立播放器
- 默认优先无损播放，失败自动回退到 115 原画
- 画质切换和记忆
- 播放进度记忆
- 播放器内移动文件，并同步刷新列表页

## 目录

- `src/content/`：115 页面内容脚本
- `src/player/`：独立播放器
- `src/background/`：后台逻辑
- `src/shared/`：共享消息和工具
- `src/lib/`：接口、解码、缩略图等通用能力

## 命令

```bash
pnpm install
pnpm test
pnpm build
pnpm zip
```

- `pnpm test`：跑测试
- `pnpm build`：构建扩展
- `pnpm zip`：按当前版本打包到 `release/`

## 本地使用

1. 执行 `pnpm install`
2. 执行 `pnpm build`
3. 打开 `chrome://extensions/`
4. 开启开发者模式
5. 加载 `dist/` 目录
6. 改代码后重新执行 `pnpm build`，再在扩展页点重新加载

## 相关文件

- 项目规则：`AGENTS.md`
- AI 接手说明：`docs/AI-HANDOFF.md`
- 变更记录：`项目日志.md`

## 开源协议

本项目采用 [GPL 3.0](LICENSE) 协议开源。

## 说明

本项目参考 `https://github.com/cbingb666/115master`，整理为谷歌扩展形态，当前主要实现基础预览和播放功能。

项目作者不懂编程，项目代码主要由 AI 按需求协助开发和维护。
