# Model Bench · 免费大模型速度排行榜

纯静态前端 + Cloudflare Worker，无传统后台、无服务器常驻。

两个功能：
1. **排行榜（首页）** — 站长的 API Key 存在 Cloudflare Secret 里，Worker 每 6 小时
   自动实测各家免费模型的首字延迟和生成速度，访客只看结果，碰不到 Key。
   OpenRouter 的免费模型自动发现（价格为 0 即入选），其他厂商用固定清单。
2. **自测工具（/tool.html）** — 原来的手动检测工具，访客用自己的 Key 测。

## 目录结构
```
model-bench/
├── public/index.html   # 排行榜首页（读 /api/results）
├── public/tool.html    # 手动检测工具（原 index.html）
├── worker.js           # Worker：静态页 + /proxy 代理 + 定时跑分 + /api/results
├── wrangler.toml       # Worker 配置（assets、cron、KV）
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

### 2. 创建 KV（存跑分结果，仅需一次）
```bash
cd ~/Documents/model-bench
wrangler kv namespace create BENCH_KV
```
把输出的 `id = "..."` 填进 `wrangler.toml` 的 `[[kv_namespaces]]`。

### 3. 配置 API Key（配几个测几个）
```bash
wrangler secret put OPENROUTER_KEY     # 推荐，免费模型自动发现
wrangler secret put GROQ_KEY
wrangler secret put GEMINI_KEY
wrangler secret put SILICONFLOW_KEY
wrangler secret put ZHIPU_KEY
wrangler secret put MISTRAL_KEY
wrangler secret put ADMIN_TOKEN        # 自己编一串随机字符，手动触发跑分用
```
没配的厂商会自动跳过，不报错。

### 4. 部署
```bash
wrangler deploy
```
部署完成后会得到一个 `https://model-bench.<sub>.workers.dev` 地址。
前端和代理都在这个地址上：**同源 `/proxy` 自动生效**，无需任何额外配置。

### 5. 触发第一轮跑分（不想等 6 小时的话）
浏览器打开：
```
https://你的地址/api/run?token=你的ADMIN_TOKEN
```
1-2 分钟后刷新首页即可看到榜单。之后每 6 小时自动更新。

### 6. 绑定自己的域名（可选）
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
- 自测工具的代理白名单：`worker.js` 的 `ALLOWED_HOSTS` 数组加一行域名。
- 排行榜的跑分对象：`worker.js` 的 `BENCH_TARGETS` 数组加一项（secret 名、
  base URL、要测的免费模型、额度说明），再 `wrangler secret put` 对应的 Key。
改完重新 `wrangler deploy`。

## 安全性说明
- 站长的 Key 存在 Cloudflare Secret 里，不进 git、不出现在任何响应中；
  访客只能拿到跑分结果 JSON，没有任何用站长 Key 发请求的入口。
- `/api/run` 需要 ADMIN_TOKEN，陌生人无法触发跑分烧额度。
- 自测工具（tool.html）的密钥只存在访客自己浏览器的 localStorage。
- 免费额度剩余量没有通用查询接口，榜单里的额度信息是 `BENCH_TARGETS`
  里手工维护的说明文字。
