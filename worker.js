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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
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
};
