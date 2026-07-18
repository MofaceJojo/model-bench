# Model Bench · Cloudflare 部署版

纯静态前端 + Cloudflare Worker 代理，无传统后台、无服务器常驻。

## 目录结构
```
model-bench/
├── public/index.html   # 前端单页（检测工具本体）
├── worker.js           # Cloudflare Worker：托管静态页 + /proxy 代理
├── wrangler.toml       # Worker 配置（assets 指向 public/）
├── server.py           # 本地开发用代理（标准库，免安装）
└── README.md
```

## 本地开发（不用 Cloudflare）
```bash
cd ~/Documents/model-bench
python3 server.py                 # 启动本地代理 localhost:9001
# 浏览器打开 public/index.html
```
页面会自动识别 localhost，默认不启代理、直连 API。

## 部署到 Cloudflare（形态 2：静态 + Worker）

### 1. 安装 wrangler（仅需一次）
```bash
npm install -g wrangler
wrangler login
```

### 2. 部署
```bash
cd ~/Documents/model-bench
wrangler deploy
```
部署完成后会得到一个 `https://model-bench.<sub>.workers.dev` 地址。
前端和代理都在这个地址上：**同源 `/proxy` 自动生效**，无需任何额外配置。

### 3. 绑定自己的域名（可选）
在 `wrangler.toml` 里取消 `routes` 注释，改成你的域名：
```toml
routes = [
  { pattern = "bench.yourdomain.com", custom_domain = true }
]
```
然后 `wrangler deploy`。

## 原理
- 浏览器直接向 OpenAI / Anthropic 等发请求会被 CORS 拦截。
- Worker 的 `/proxy?url=<目标>` 在 Cloudflare 边缘替浏览器转发请求，并补上 CORS 头。
- Worker 只放行白名单域名（见 `worker.js` 的 `ALLOWED_HOSTS`），其他人无法把它当通用代理滥用。
- API Key 由浏览器发给 Worker、再转发给目标 API，不落盘、不进日志。

## 增加新的目标厂家
编辑 `worker.js` 的 `ALLOWED_HOSTS` 数组，加一行域名，重新 `wrangler deploy`。

## 安全性提示
- 这是**个人工具**，Worker 不是公开代理。若对外暴露，请加 Token 校验。
- 密钥只存在浏览器 localStorage。
