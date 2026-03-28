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

### 无损播放失败不降级 (v1.0.33)
**根因**: 初始化时只获取无损源或 HLS 源之一，不会同时获取。当无损源返回 URL 但实际无效（如过期、需特殊认证），播放失败时 `m3u8List` 为空，导致无法降级。

**修复**:
- `src/player/player.ts`: `init()` 改用 `Promise.all` 并行获取无损源和 HLS 源，确保 `m3u8List` 始终可用
- `fallbackToHls()` 增加详细日志，便于排查降级流程
- `ensureOriginalSourceLoaded()` 逻辑正确，能在用户手动切换"115原画"时重新获取 m3u8

### 设置面板点击触发播放/暂停 (v1.0.33)
**根因**: `isInteractiveTarget` 缺少 ArtPlayer 设置面板的选择器。
**修复**: 添加 `.art-settings, .art-setting-item, .art-settings-body` 选择器。

### 画质切换点击触发播放/暂停 (v1.0.33)
**根因**: `isInteractiveTarget` 使用了错误的 CSS 选择器 `.art-quality`，ArtPlayer 实际使用的是 `.art-selector` 组件。
**修复**: 改为 `.art-selector, .art-selector-item, .art-qualitys, .art-quality-item` 选择器（兼容不同版本）。

### 其他潜在交互问题预防 (v1.0.33)
**检查**: 查阅 ArtPlayer CSS 源码，补充了所有可能的交互组件选择器：
- 设置面板：`.art-settings, .art-setting, .art-setting-item, .art-setting-inner, .art-setting-body, .art-setting-radio, .art-radio-item, .art-setting-range, .art-setting-checkbox`
- 通知/信息：`.art-notice, .art-info, .art-info-item, .art-info-close`

### 收藏状态不准确 (v1.0.33)
**根因**: 收藏状态从 URL 参数获取，而 URL 参数来自文件列表页 DOM 提取。用户取消收藏后，115 页面 DOM 可能没有更新，再次打开视频时状态还是旧的。
**修复**: 
- `src/player/player.ts`: 添加 `fetchFileFavoriteStatus()` 方法，通过 API 获取最新收藏状态
- `src/player/core/overlay.ts`: 添加 `updateFavoriteStatus()` 方法，异步更新收藏图标
- 使用 `/files/video` API（GET 请求），返回的 `is_mark` 字段是字符串类型 `'1'` 或 `'0'`
- 添加 `MAIN_WORLD_GET` 消息类型，用于执行 GET 请求（原来的 `MAIN_WORLD_FETCH` 只支持 POST）

## 待排查问题
- 切换到"115原画"时提示"播放失败，无可用的视频源"

## 构建命令
pnpm build
pnpm zip

## v1.1.1 修复 (2026-03-28)
- **浏览器重启后播放器不加载**：`video-page-early.js` 用 `document.write` 覆盖页面后，manifest 注册的 content script 不会自动注入
- 解决方案：在 `video-page-early.js` 中动态加载 content script 模块，通过 `.vite/manifest.json` 获取正确的文件路径

## 性能优化 (v1.1.0)
- 帧解码从串行改为并行（5帧同时解码）
- 调度并发数从 2 提升到 3
- 图片输出改用 Blob URL（减少 Base64 编码开销）
- IntersectionObserver 可见性检测（只加载可见区域）
- 滚动停止后才加载（200ms 延迟）
- 元素离开视口自动取消加载任务

## 维护约定
- 版号文件：package.json + manifest.json 同步更新
- 用户要求：正向反馈或完成功能时，主动升版号、更新文档、提交 git
- 用户要求：每次修改代码后，主动执行 `pnpm build` 构建并确认结果
- 画质记忆（按视频）优先在播放器页使用 `localStorage` 保存 `pickCode -> { label, quality }`；不要优先依赖 Service Worker runtime 消息链做偏好存取，冷启动时不稳定


## 新增功能 (v1.0.29)
### 文件列表滚动位置记忆
- 新文件：`src/content/core/scroll-history.ts`（ScrollPositionManager 类）
- 集成到 `HomeController.bindDocument()` 中
- sessionStorage 存储，key 为 `cid_offset`，150ms 节流保存
- 滚动容器：`.list-cell` → `.list-contents`（列表视图）或 `.list-thumb`（网格视图）
- 切换目录时 115 会重建 `.list-cell`，用 MutationObserver 监听并重新绑定
