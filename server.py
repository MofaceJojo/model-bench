#!/usr/bin/env python3
"""
Model Bench CORS Proxy (stdlib only, no pip install needed).
Only forwards to OpenAI-compatible APIs — NEVER touch arbitrary hosts by default.

Config:
  python3 server.py [--host 0.0.0.0] [--port 9001]
  ALLOWED_HOSTS env for additional trusted hostnames (comma-separated).
"""
import argparse, os, urllib.parse, urllib.request, urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

ALLOWED_DEFAULT = {
    "api.openai.com","openrouter.ai","api.anthropic.com","api.deepseek.com",
    "api.siliconflow.cn","api.groq.com","api.together.xyz","generativelanguage.googleapis.com"
}

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                         "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Max-Age": "86400" })

    def do_GET(self):
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = dict(urllib.parse.parse_qsl(parsed.query))
            target = params.get("url") or self.path
            if not target.startswith("http"): target = "https://" + target
            host = urllib.parse.urlparse(target).hostname or ""
            allowed = ALLOWED_DEFAULT.union({h.strip() for h in os.environ.get("ALLOWED_HOSTS","").split(",") if h.strip()})
            if host not in allowed:
                self.send_json(403, {"error": f"host {host} not allowed", "allowed": sorted(allowed)})
                return
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            fwd_headers = dict(self.headers)
            # Cloudflare/providers block the default "Python-urllib" UA -> 403.
            # Force a browser UA so the proxy can reach OpenAI/OpenRouter/etc.
            fwd_headers["User-Agent"] = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                                          "Chrome/120.0.0.0 Safari/537.36")
            req = urllib.request.Request(target, data=body, method=self.command, headers=fwd_headers)
            with urllib.request.urlopen(req, timeout=60) as r:
                out = r.read(); code = 200
                ct = r.headers.get("Content-Type","application/octet-stream")
                hds = {"Access-Control-Allow-Origin": "*", "Content-Type": ct}
                self.send(code, hds, out)
        except urllib.error.HTTPError as e:
            body = e.read() or b""; ct = e.headers.get("Content-Type","text/plain") if e.headers else "text/plain"
            self.send(e.code, {"Content-Type": ct, "Access-Control-Allow-Origin": "*"}, body)
        except Exception as e:
            self.send_json(502, {"error": str(e)})

    def send(self, code, hdrs, body):
        self.send_response(code)
        [self.send_header(k,v) for k,v in hdrs.items()]
        self.end_headers(); self.wfile.write(body)

    def send_json(self, code, obj):
        self.send(code, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}, str(obj).encode())

def main():
    a = argparse.ArgumentParser(); a.add_argument("--host", default="127.0.0.1"); a.add_argument("--port", type=int, default=9001)
    args = a.parse_args(); srv = HTTPServer((args.host, args.port), Handler)
    print(f"🧊 Model Bench proxy → http://{args.host}:{args.port}")
    print(f"   ALLOWED: {', '.join(sorted(ALLOWED_DEFAULT))}")
    print(f"   CTRL+C to stop"); srv.serve_forever()

if __name__ == "__main__":
    main()
