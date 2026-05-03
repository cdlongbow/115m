# 115m

`115m` 是一个 115 网盘增强扩展。

主要围绕三块体验增强：
- 列表页媒体增强：文件夹封面、图片区、视频预览
- 图片查看器增强：切图、缩放、删除
- 点击视频后用独立播放器播放

协作规则看 `AGENTS.md`。

## 功能

- 列表页文件夹封面卡片
- 列表页图片聚合展示
- 列表页视频预览图
- 图片查看器：缩略图条、滚轮切图/缩放、删除
- 左侧栏快捷入口和自定义显示
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
pnpm release:check
```

- `pnpm test`：跑测试
- `pnpm build`：构建扩展
- `pnpm zip`：按当前版本打包到 `release/`
- `pnpm release:check`：检查版本、zip、发布说明和 gh 登录状态

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

## 开源协议

本项目采用 [GPL 3.0](LICENSE) 协议开源。

## 说明

感谢 [115master](https://github.com/cbingb666/115master) 的开源有了此项目的基础。
后续又整合 [115-魔改](https://sleazyfork.org/zh-CN/scripts/560291-115-%E9%AD%94%E6%94%B9) 进 Chrome 扩展，主要为自用场景继续发展。

项目作者不懂编程，项目代码主要由 AI 按需求协助开发和维护。
