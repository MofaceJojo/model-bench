// Model Bench — Cloudflare Worker
// 1) Serves the static app from the `public/` folder (via ASSETS binding)
// 2) Proxies API calls to allowed hosts so the browser avoids CORS
//
// Deploy:  wrangler deploy
// Local:   wrangler dev   (serves public/ + /proxy)

const ALLOWED_HOSTS = [
  "api.openai.com",
  "openrouter.ai",
  "api.anthropic.com",
  "api.deepseek.com",
  "api.siliconflow.cn",
  "api.groq.com",
  "api.together.xyz",
  "api.fireworks.ai",
  "api.mistral.ai",
  "api.x.ai",
  "generativelanguage.googleapis.com",
  "api.perplexity.ai",
  "api.minimax.chat",
  "api.stepfun.com",
  "qianfan.baidubce.com",
  "integrate.api.nvidia.com",
  "api.cerebras.ai",
  "models.github.ai",
  "api.novita.ai",
  "api.ppio.cn",
  "api.moonshot.cn",
  "dashscope.aliyuncs.com",
  "api.hunyuan.cloud.tencent.com",
  "ark.cn-beijing.volces.com",
  "open.bigmodel.cn",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type,accept,origin,x-requested-with",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ---- 定时跑分配置 ----
// secret: 用 `wrangler secret put <名字>` 配置；没配的厂商自动跳过。
// quota:  免费额度说明（API 查不到剩余额度，手工维护）。
// models: 要测的免费模型；openrouter 走自动发现，不用写。
const BENCH_TARGETS = [
  { id: "openrouter", name: "OpenRouter", secret: "OPENROUTER_KEY",
    base: "https://openrouter.ai/api/v1", discover: true,
    applyUrl: "https://openrouter.ai/keys",
    quota: "免费模型每天 50 次请求（历史充值满 $10 提升到 1000 次/天）" },
  { id: "groq", name: "Groq", secret: "GROQ_KEY",
    base: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    applyUrl: "https://console.groq.com/keys",
    quota: "免费层按模型限次，常用模型约 1000+ 次/天，速度极快" },
  { id: "gemini", name: "Google Gemini", secret: "GEMINI_KEY",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash", "gemini-2.5-flash"],
    applyUrl: "https://aistudio.google.com/apikey",
    quota: "免费层 Flash 系列每天约 1500 次请求（以官网为准）" },
  { id: "siliconflow", cn: true, name: "硅基流动", secret: "SILICONFLOW_KEY",
    base: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-7B-Instruct", "THUDM/glm-4-9b-chat"],
    applyUrl: "https://cloud.siliconflow.cn",
    quota: "注册送额度；带 (free) 标记的小模型长期免费" },
  { id: "zhipu", cn: true, name: "智谱", secret: "ZHIPU_KEY",
    base: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash"],
    applyUrl: "https://open.bigmodel.cn",
    quota: "glm-4-flash 长期免费，不限总量（有并发限制）" },
  { id: "mistral", name: "Mistral", secret: "MISTRAL_KEY",
    base: "https://api.mistral.ai/v1",
    models: ["mistral-small-latest"],
    applyUrl: "https://console.mistral.ai",
    quota: "免费实验层限 1 请求/秒" },
  { id: "cerebras", name: "Cerebras", secret: "CEREBRAS_KEY",
    base: "https://api.cerebras.ai/v1",
    models: ["llama-3.3-70b"],
    applyUrl: "https://cloud.cerebras.ai",
    quota: "免费层每天百万级 token，速度媲美 Groq" },
  { id: "nvidia", name: "NVIDIA NIM", secret: "NVIDIA_KEY",
    base: "https://integrate.api.nvidia.com/v1",
    models: ["meta/llama-3.3-70b-instruct"],
    applyUrl: "https://build.nvidia.com",
    quota: "注册送 1000 积分（约 1000 次请求）" },
  { id: "github", name: "GitHub Models", secret: "GITHUB_MODELS_TOKEN",
    base: "https://models.github.ai/inference",
    models: ["openai/gpt-4o-mini"],
    applyUrl: "https://github.com/settings/tokens",
    quota: "GitHub 账号即可用，按账号等级每天限次（PAT 需勾选 models 权限）" },
  // --- 国内厂商：手机号注册即可，境内直连无障碍 ---
  { id: "aliyun", cn: true, name: "阿里云百炼", secret: "ALIYUN_KEY",
    base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-turbo", "qwen-plus"],
    applyUrl: "https://bailian.console.aliyun.com",
    quota: "通义千问系列各送 100 万 token（首次开通，有效期半年）" },
  { id: "volcengine", cn: true, name: "火山方舟", secret: "VOLCENGINE_KEY",
    base: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-lite-4k"],
    applyUrl: "https://console.volcengine.com/ark",
    quota: "豆包系列每个模型送 50 万 token" },
  { id: "moonshot", cn: true, name: "月之暗面 Kimi", secret: "MOONSHOT_KEY",
    base: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k"],
    applyUrl: "https://platform.moonshot.cn",
    quota: "注册送 15 元额度，长文本能力强" },
  { id: "baidu", cn: true, name: "百度千帆", secret: "BAIDU_KEY",
    base: "https://qianfan.baidubce.com/v2",
    models: ["ernie-speed-128k", "ernie-lite-8k"],
    applyUrl: "https://console.bce.baidu.com/qianfan",
    quota: "ERNIE Speed / Lite 系列长期免费" },
  { id: "tencent", cn: true, name: "腾讯混元", secret: "TENCENT_KEY",
    base: "https://api.hunyuan.cloud.tencent.com/v1",
    models: ["hunyuan-lite"],
    applyUrl: "https://console.cloud.tencent.com/hunyuan",
    quota: "hunyuan-lite 长期免费，不限量" },
];

// 能力档位：人工维护的静态标注（参考公开评测），按顺序首个命中生效。
// ponytail: 正则猜档位，认不出的落到「中」，看到标错来这里补规则
const TIER_RULES = [
  [/405b|235b|670b|550b|deepseek-r1|deepseek.*(v3|chat)|grok-[34]|gpt-4o(?!-mini)|gpt-4\.1(?!-mini|-nano)|gemini-2\.5-pro|glm-4\.[56]|qwen3?-max|hunyuan-large|ultra/i, "旗舰"],
  [/70b|72b|49b|32b|30b|27b|24b|gemini-2\.[05]-flash(?!-lite)|mistral-small|gpt-4o-mini|gpt-4\.1-mini|qwq|glm-4-air|command|step-2|hy3/i, "强"],
  [/2[0-2]b|1[0-6]b|[7-9]b|glm-4-flash|gemma|phi|flash-lite/i, "中"],
  [/[1-6]b|nano|mini|tiny|lite|safety/i, "轻量"],
];
function tierOf(model) {
  for (const [re, tier] of TIER_RULES) if (re.test(model)) return tier;
  return "中";
}

const DISCOVER_CAP = 10;   // OpenRouter 自动发现的免费模型最多测这么多
const BENCH_TIMEOUT = 20000;
const BENCH_PROMPT = "用不超过50个字介绍一下你自己。";

// 从 OpenRouter /models 自动发现免费模型（输入输出价格都为 0）
async function discoverOpenRouterFree(key) {
  const resp = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return [];
  const { data = [] } = await resp.json();
  return data
    .filter((m) => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, DISCOVER_CAP)
    .map((m) => m.id);
}

// 测一个模型：流式请求，量首字延迟(TTFT)和生成速度
async function benchOne(base, key, model) {
  const t0 = Date.now();
  let tFirst = 0, chars = 0;
  try {
    const resp = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: BENCH_PROMPT }],
        max_tokens: 100,
        stream: true,
      }),
      signal: AbortSignal.timeout(BENCH_TIMEOUT),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 150);
      return { model, ok: false, error: `HTTP ${resp.status} ${text}` };
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) {
            if (!tFirst) tFirst = Date.now();
            chars += delta.length;
          }
        } catch { /* 忽略非 JSON 行 */ }
      }
    }
    if (!tFirst) return { model, ok: false, error: "无内容返回" };
    const tEnd = Date.now();
    // ponytail: token 用字符数估算（中文≈1字/token），排名够用；要精确就解析 usage
    const tokens = Math.round(chars / 1.2);
    const genSec = Math.max((tEnd - tFirst) / 1000, 0.001);
    return {
      model, ok: true,
      ttft: tFirst - t0,
      total: tEnd - t0,
      tps: Math.round((tokens / genSec) * 10) / 10,
    };
  } catch (e) {
    return { model, ok: false, error: String(e).slice(0, 150) };
  }
}

async function runBench(env) {
  const results = [];
  for (const t of BENCH_TARGETS) {
    const key = env[t.secret];
    if (!key) continue;
    let models = t.models || [];
    if (t.discover) {
      try { models = await discoverOpenRouterFree(key); } catch { models = []; }
    }
    for (const model of models) {
      const r = await benchOne(t.base, key, model);
      results.push({ provider: t.id, providerName: t.name, quota: t.quota, tier: tierOf(model), ...r });
    }
  }
  const doc = { updatedAt: new Date().toISOString(), results };
  await env.BENCH_KV.put("latest", JSON.stringify(doc));
  return doc;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ---- 免费资源目录：厂商、额度、申请链接、Key 配置状态（不暴露 Key 本身）----
    if (url.pathname === "/api/directory") {
      return json(BENCH_TARGETS.map((t) => ({
        id: t.id, name: t.name, quota: t.quota, applyUrl: t.applyUrl, cn: !!t.cn,
        secretName: t.secret, configured: !!env[t.secret],
      })));
    }

    // ---- 排行榜数据 ----
    if (url.pathname === "/api/results") {
      const doc = await env.BENCH_KV.get("latest");
      return doc
        ? new Response(doc, { headers: { ...CORS, "Content-Type": "application/json" } })
        : json({ updatedAt: null, results: [] });
    }

    // ---- 手动触发一轮跑分（需 ADMIN_TOKEN，首次部署后用一次即可）----
    if (url.pathname === "/api/run") {
      if (!env.ADMIN_TOKEN || url.searchParams.get("token") !== env.ADMIN_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
      ctx.waitUntil(runBench(env));
      return json({ started: true, note: "跑分已在后台开始，约 1-2 分钟后刷新排行榜" });
    }

    // ---- Proxy endpoint ----
    const isProxy = url.pathname === "/proxy" || url.searchParams.has("url");
    if (isProxy) {
      let target = url.searchParams.get("url");
      if (!target) return json({ error: "missing ?url= parameter" }, 400);
      if (!/^https?:\/\//i.test(target)) target = "https://" + target;

      let host;
      try {
        host = new URL(target).hostname.toLowerCase();
      } catch {
        return json({ error: "invalid target url" }, 400);
      }

      if (!ALLOWED_HOSTS.includes(host)) {
        return json({ error: `host not allowed: ${host}`, allowed: ALLOWED_HOSTS }, 403);
      }

      // Forward only safe headers (Authorization carries the API key)
      const forwardHeaders = {};
      for (const key of [
        "authorization",
        "content-type",
        "accept",
        "user-agent",
        "x-requested-with",
        "x-api-key",
        "anthropic-version",
        "api-key",
        "x-api-version",
      ]) {
        const v = request.headers.get(key);
        if (v) forwardHeaders[key] = v;
      }

      const init = {
        method: request.method,
        headers: forwardHeaders,
        redirect: "follow",
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }

      try {
        const resp = await fetch(target, init);
        const headers = new Headers(resp.headers);
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
        return new Response(resp.body, {
          status: resp.status,
          headers,
        });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // ---- Serve static assets ----
    return env.ASSETS.fetch(request);
  },

  // 定时跑分（wrangler.toml 的 [triggers] crons）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBench(env));
  },
};
