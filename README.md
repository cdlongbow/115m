# 115m 扩展（简版说明）

这是一个 115 网盘增强扩展。

主要功能：
- 列表页视频缩略图预览
- 点击文件名用自定义播放器播放
- 默认优先无损播放（失败时可切到 115 原画等档位）
- 支持下载直链

## 项目目录

- 扩展项目：`115m-extension/`
- 打包输出：`115m-extension/dist/`
- 发布压缩包：`115m-extension/release/115m-extension-v版本号.zip`

## 常用命令

在 Git Bash 中执行：

```bash
cd /e/qh775885/115m/115m-extension
pnpm install
pnpm dev
```

其它命令：

```bash
pnpm type-check
pnpm build
pnpm zip
```

说明：
- `pnpm dev`：开发监听模式
- `pnpm build`：正式构建
- `pnpm zip`：构建并生成带版本号的可分享压缩包

## 本地加载扩展

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `115m-extension/dist`

每次改代码后：
- 重新加载扩展
- 刷新 115 页面

## 分享给别人

1. 执行：`pnpm zip`
2. 把 `115m-extension/release/115m-extension-v版本号.zip` 发给对方
3. 对方解压后按“本地加载扩展”步骤安装
