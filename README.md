# 115m

`115m` 是一个 115 网盘增强扩展。

这个项目主要做两件事：
- 列表页视频预览
- 点击视频后用独立播放器播放

开发前先看：`AGENTS.md`

## 现在的主要功能

- 列表页视频预览图
- 未转码视频自动静默加入 VIP 加速队列
- 点击视频进入独立播放器
- 默认优先无损播放，失败自动回退到 115 原画
- 画质切换和记忆
- 播放进度记忆
- 播放器内移动文件，并同步刷新列表页

## 项目结构

- `src/content/`：115 页面内容脚本
- `src/player/`：独立播放器
- `src/background/`：后台逻辑
- `src/shared/`：共享消息和工具
- `src/lib/`：接口、解码、缩略图等通用能力

## 常用命令

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

## 开发约定

- 统一使用中文
- 统一使用 `pnpm`
- 改代码后默认执行 `pnpm build`
- 项目规则看 `AGENTS.md`
- 变更记录看 `项目日志.md`
