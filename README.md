# 115m 扩展

这是一个 115 网盘增强扩展，当前聚焦两个核心能力：列表预览图、点击无损播放。

## 目录说明

- 源码：`src/`
- 构建输出：`dist/`
- 发布压缩包输出：`release/`

## 命令

```bash
pnpm install
pnpm build
pnpm zip
```

- `pnpm build`：正式构建（开发改动后用这个验证）
- `pnpm zip`：构建并打包 zip（发布时使用）

## 本地加载

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `dist/`

## 发布

1. 执行：`pnpm zip`
2. 在 `release/` 目录获取压缩包

## 开发规范

- 架构说明：`架构说明.md`
- 验收流程：`开发验收清单.md`
- 协作约定：`CONTRIBUTING.md`
