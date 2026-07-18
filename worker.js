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
    quota: "免费模型每天 50 次请求（历史充值满 $10 提升到 1000 次/天）" },
  { id: "groq", name: "Groq", secret: "GROQ_KEY",
    base: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    quota: "免费层按模型限次，常用模型约 1000+ 次/天，速度极快" },
  { id: "gemini", name: "Google Gemini", secret: "GEMINI_KEY",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.0-flash", "gemini-2.5-flash"],
    quota: "免费层 Flash 系列每天约 1500 次请求（以官网为准）" },
  { id: "siliconflow", name: "硅基流动", secret: "SILICONFLOW_KEY",
    base: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-7B-Instruct", "THUDM/glm-4-9b-chat"],
    quota: "注册送额度；带 (free) 标记的小模型长期免费" },
  { id: "zhipu", name: "智谱", secret: "ZHIPU_KEY",
    base: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash"],
    quota: "glm-4-flash 长期免费，不限总量（有并发限制）" },
  { id: "mistral", name: "Mistral", secret: "MISTRAL_KEY",
    base: "https://api.mistral.ai/v1",
    models: ["mistral-small-latest"],
    quota: "免费实验层限 1 请求/秒" },
];

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
      results.push({ provider: t.id, providerName: t.name, quota: t.quota, ...r });
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
