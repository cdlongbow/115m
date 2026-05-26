# 115 Open API 授权与视频转码

适用场景：

- 接入 115 Open API
- 实现官方接口提交视频转码
- 排查 access_token / refresh_token 授权链路

## 推荐授权方式

- 优先使用“手机扫码授权 PKCE 模式”
- 适合无后端服务的第三方客户端
- 不需要 AppSecret，适合开源 Chrome 扩展
- 授权成功后保存 access_token、refresh_token、expires_in 到本地存储
- access_token 过期前使用 refresh_token 刷新

## 手机扫码授权 PKCE 模式

官方说明：适用于无后端服务的第三方客户端，使用 OAuth 2.0 + PKCE 模式授权，无需提供 AppSecret。

### 1. 获取设备码和二维码内容

- Method: POST
- URL: `https://passportapi.115.com/open/authDeviceCode`
- Header: `Content-Type: application/x-www-form-urlencoded`
- Body:
  - `client_id`: APP ID
  - `code_challenge`: `url_safe(base64_encode(sha256(code_verifier)))`
  - `code_challenge_method`: `sha256`
- 返回关键字段：
  - `data.uid`: 设备码 / 二维码 ID
  - `data.time`: 轮询校验时间戳
  - `data.qrcode`: 二维码内容
  - `data.sign`: 轮询校验签名

### 2. 轮询二维码状态

- Method: GET
- URL: `https://qrcodeapi.115.com/get/status/`
- Query:
  - `uid`: 从 authDeviceCode 返回
  - `time`: 从 authDeviceCode 返回
  - `sign`: 从 authDeviceCode 返回
- 返回关键字段：
  - `state=0`: 二维码无效，结束轮询
  - `state=1`: 继续轮询
  - `data.status=1`: 扫码成功，等待确认
  - `data.status=2`: 确认登录 / 授权，结束轮询

### 3. 设备码换 access_token

- Method: POST
- URL: `https://passportapi.115.com/open/deviceCodeToToken`
- Header: `Content-Type: application/x-www-form-urlencoded`
- Body:
  - `uid`: 二维码 ID / 设备码
  - `code_verifier`: 生成 code_challenge 的原始随机字符串
- 返回关键字段：
  - `data.access_token`: 资源接口访问凭证
  - `data.refresh_token`: 刷新凭证，有效期 1 年
  - `data.expires_in`: access_token 有效期，单位秒

## 授权码模式

官方说明：建议开发者服务端参与授权。

### 1. 请求授权

- Method: GET
- URL: `https://passportapi.115.com/open/authorize`
- Query:
  - `client_id`: APP ID
  - `redirect_uri`: 授权成功后的回调地址，需在开放平台应用域名中配置
  - `response_type`: 固定为 `code`
  - `state`: 防 CSRF 随机值，建议必传并校验
- 返回：成功后重定向到 `redirect_uri`，附带授权码 `code` 和原样返回的 `state`

### 2. 授权码换 access_token

- Method: POST
- URL: `https://passportapi.115.com/open/authCodeToToken`
- Header: `Content-Type: application/x-www-form-urlencoded`
- Body:
  - `client_id`: APP ID
  - `client_secret`: APP Secret
  - `code`: 授权码
  - `redirect_uri`: 与请求授权时一致
  - `grant_type`: 固定为 `authorization_code`
- 返回关键字段：
  - `data.access_token`
  - `data.refresh_token`
  - `data.expires_in`

### 项目判断

- 不适合纯开源扩展直接使用
- 因为换 token 需要 AppSecret，写入扩展或仓库会泄露
- 仅在有后端中转服务时考虑

## 刷新 access_token

- Method: POST
- URL: `https://passportapi.115.com/open/refreshToken`
- Header: `Content-Type: application/x-www-form-urlencoded`
- Body:
  - `refresh_token`: 刷新凭证
- 返回关键字段：
  - `data.access_token`: 新 access_token，同时刷新有效期
  - `data.refresh_token`: 新 refresh_token，有效期不延长不改变
  - `data.expires_in`: access_token 有效期，单位秒
- 注意：不要频繁刷新，否则会触发频控

## 提交视频转码

- Method: POST
- Path: `域名 + /open/video/video_push`
- Header:
  - `Authorization: Bearer access_token`
- Body(form-data):
  - `pick_code`: 文件提取码
  - `op`: 转码方式
    - `vip_push`: 根据 VIP 等级加速
    - `pay_push`: 枫叶加速
- 返回关键字段：
  - `state`: true 成功，false 失败
  - `message`: 操作返回消息，成功时为空
  - `code`: 成功时返回 0
  - `data`: 数据

## 项目落地建议

- 使用扫码 PKCE 作为默认授权方式
- 不把 AppSecret 写入代码或仓库
- token 只存本地，不写入 Git
- 自动 VIP 加速转码优先走官方 `/open/video/video_push`
- 旧的 115vod 页面 / iframe / direct fetch 方案只作为临时兜底或废弃
