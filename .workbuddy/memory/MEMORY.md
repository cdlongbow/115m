# 115m 项目记忆

## 项目概况
- 115m: Chrome 扩展，给 115 网盘加视频预览图和无损播放
- 技术栈: Vite + TypeScript, TailwindCSS, Artplayer, HLS.js
- 源码: e:/qh775885/115m/src/

## 播放器核心文件
- 入口: src/player/player.ts（PlayerManager 类）
- 事件处理: src/player/core/events.ts（点击播放/暂停逻辑）
- 顶层遮罩: src/player/core/overlay.ts（PlayerOverlayController）
- 进度条预览: src/player/core/hover-preview.ts

## 已解决的问题
### 播放器点击播放/暂停（UI可见时不工作）
**根因**: `isInteractiveTarget` 把 `$controls/$bottom` 整个容器都视为交互控件，但这些容器有大片空白区域，点击空白处应该触发播放/暂停。同时 ArtPlayer 内部有 poster/subtitle/layers 等覆盖层，UI 可见时拦截了点击。
- 旧逻辑：`controls.contains(target)` 返回 true → 直接 return → 点击 controls 空白处无反应
- UI 可见时 poster 显示 → 点击命中 poster → 走了错误的分支

**修复**: 简化逻辑，`isInteractiveTarget` 只识别真正的交互元素（button/a/input、进度条、设置面板、播放列表）。其他所有区域（video、poster、mask、controls 空白处、header 空白处）统一 toggle 播放状态。

### 播放器音量图标点击触发播放/暂停 (v1.0.28)
**根因**: ArtPlayer 控件使用 SVG 图标，不是 HTMLElement。`isInteractiveTarget` 中 `instanceof HTMLElement` 判断漏掉了 SVG 元素。
**修复**: 改为 `instanceof Element`，对 SVGElement 额外检查其 parent 是否在 `.art-controls-left/right/center` 内。

### 面包屑导航改用 API (v1.0.30)
**修复**: 改用 115 文件列表 API（`getPlaylist` → `FilesRes.path`）获取目录路径，完全不依赖 DOM 提取。

### "undefined action!" 闪烁 + 页面过渡闪烁 (v1.0.31)
**根因**: crxjs/Vite 把 content script 包进异步 loader（`await import()`），即使声明 `document_start` 也会延迟到 115 内联脚本之后执行。
**修复**: 用 `chrome.scripting.registerContentScripts` 在 background `onInstalled` 时注册一个 `public/video-page-early.js` 纯 JS 文件，`runAt: 'document_start'` 同步执行，抢在 115 脚本之前 `document.open()/write()/close()` 替换整个页面。同时解决了 "undefined action!" 和过渡闪烁两个问题。
**关键文件**: `public/video-page-early.js`、`src/background/index.ts`（`registerEarlyOverrideScript()`）、`src/content/video-page.ts`
**重要**: `video-page-early.js` 是页面的唯一 DOM 来源。`video-page.ts` 不再做 `document.write`，仅负责初始化逻辑。所有 DOM 结构变更（如 `#main-layout`、`#playlist-sidebar`）必须同时修改 `video-page-early.js`。

### 播放列表侧栏不显示 (v1.0.32)
**根因**: 三个问题叠加
1. `public/video-page-early.js` 的 HTML 中没有 `#main-layout` 和 `#playlist-sidebar`，导致 `overlay.ts` 的 `mountSidebarContent()` 找不到侧栏元素
2. `video-page.ts` 的 IIFE `document.write` 虽然包含这些元素，但 Vite 异步加载时可能和 early.js 产生竞态（二次 `document.open/write/close`）
3. `fetchPlaylistItems()` 在 URL 中没有 `cid` 时直接返回空数组，而 `cid` 来自文件列表页 DOM 提取的 `parentId`，可能为空

**修复**:
- `public/video-page-early.js`: 添加 `#main-layout`（flex 容器）和 `#playlist-sidebar`（`width:0` → `300px`）及对应 CSS
- `src/content/video-page.ts`: 移除 IIFE `document.write`，避免和 early.js 的竞态。只保留初始化逻辑
- `src/shared/messages.ts`: `MsgFetchPlaylist.data` 增加 `pickCode` 可选字段
- `src/background/index.ts`: `FETCH_PLAYLIST` handler 当没有 `cid` 时，先通过 `webapi.115.com/files/video?pick_code=xxx` 获取 `parent_id`，再请求文件列表
- `src/player/player.ts`: `fetchPlaylistItems()` 和 `fetchBreadcrumbs()` 都传入 `pickCode` 作为降级方案
- `src/player/core/overlay.ts`: `mountSidebarContent` 增加二次查找 sidebar 的 fallback，添加调试日志

## 构建命令
pnpm build
pnpm zip

## 维护约定
- 版号文件：package.json + manifest.json 同步更新
- 用户要求：正向反馈或完成功能时，主动升版号、更新文档、提交 git
- 用户要求：每次修改代码后，主动执行 `pnpm build` 构建并确认结果


## 新增功能 (v1.0.29)
### 文件列表滚动位置记忆
- 新文件：`src/content/core/scroll-history.ts`（ScrollPositionManager 类）
- 集成到 `HomeController.bindDocument()` 中
- sessionStorage 存储，key 为 `cid_offset`，150ms 节流保存
- 滚动容器：`.list-cell` → `.list-contents`（列表视图）或 `.list-thumb`（网格视图）
- 切换目录时 115 会重建 `.list-cell`，用 MutationObserver 监听并重新绑定
