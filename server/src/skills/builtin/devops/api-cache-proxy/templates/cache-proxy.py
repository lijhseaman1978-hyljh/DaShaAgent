#!/usr/bin/env python3
"""
本地API响应缓存代理 — 通用模板
监听本地端口，转发请求到目标API，缓存响应到本地磁盘。
相同请求（相同模型+相同消息）从缓存直接返回，永不过期。
支持任意 OpenAI-compatible API。

用法:
  1. 修改 TARGET_BASE 为目标API地址
  2. python cache-proxy.py
  3. 将config.yaml中对应provider的base_url改为 http://127.0.0.1:<PORT>/v1
"""

import hashlib
import json
import os
import pickle
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

# ============================================================
# 配置区 — 修改以下变量适配目标API
# ============================================================
PORT = 8650
TARGET_BASE = "https://api.deepseek.com"  # 改成你的目标API地址
CACHE_DIR = os.path.expanduser("~/.dasha/cache/proxy_responses")
# ============================================================

os.makedirs(CACHE_DIR, exist_ok=True)


def _cache_key(body_bytes: bytes) -> str:
    return hashlib.sha256(body_bytes).hexdigest()


def _get_from_cache(key: str):
    path = os.path.join(CACHE_DIR, key)
    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                return pickle.load(f)
        except Exception:
            return None
    return None


def _save_to_cache(key: str, response_data: dict):
    path = os.path.join(CACHE_DIR, key)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(response_data, f)
    os.replace(tmp, path)


class ProxyHandler(BaseHTTPRequestHandler):
    server_version = "APICacheProxy/1.0"

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        self._proxy(None)

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        self._proxy(body)

    def _proxy(self, body: bytes):
        path = self.path
        url = f"{TARGET_BASE}{path}"

        # 判断是否应缓存（仅非流式POST）
        should_cache = False
        if body:
            try:
                req_json = json.loads(body)
                should_cache = not req_json.get("stream", False)
            except json.JSONDecodeError:
                pass

        ckey = _cache_key(body) if (body and should_cache) else None

        # 缓存命中
        if ckey:
            cached = _get_from_cache(ckey)
            if cached:
                self._serve_cached(cached)
                return

        # 转发
        req_headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            "Authorization": self.headers.get("Authorization", ""),
        }
        for h in ("Accept",):
            v = self.headers.get(h)
            if v:
                req_headers[h] = v

        try:
            req = urllib.request.Request(url, data=body, headers=req_headers,
                                         method=self.command)
            with urllib.request.urlopen(req, timeout=300) as resp:
                resp_headers = dict(resp.headers)
                raw_body = resp.read()
                if ckey:
                    _save_to_cache(ckey, {
                        "status": resp.status,
                        "headers": resp_headers,
                        "body": raw_body,
                    })
                self._serve_raw(resp.status, resp_headers, raw_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self._serve_raw(e.code, dict(e.headers), err_body)
        except Exception as e:
            self._serve_raw(502, {"Content-Type": "text/plain"},
                            f"Proxy Error: {e}".encode())

    def _serve_cached(self, resp_data: dict):
        self.send_response(resp_data["status"])
        for k, v in resp_data.get("headers", {}).items():
            kl = k.lower()
            if kl in ("transfer-encoding", "content-encoding", "content-length",
                      "connection", "keep-alive"):
                continue
            if kl.startswith("x-") or kl.startswith("cf-"):
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(resp_data["body"])))
        self.send_header("X-Cache-Status", "HIT (local)")
        self.end_headers()
        self.wfile.write(resp_data["body"])

    def _serve_raw(self, status: int, headers: dict, body: bytes):
        self.send_response(status)
        for k, v in headers.items():
            kl = k.lower()
            if kl in ("transfer-encoding", "content-encoding",
                      "connection", "keep-alive"):
                continue
            if kl.startswith("x-") or kl.startswith("cf-") or kl.startswith("strict-"):
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Cache-Status", "BYPASS")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    cache_count = len(os.listdir(CACHE_DIR))
    server = HTTPServer(("127.0.0.1", PORT), ProxyHandler)
    print(f"╔══════════════════════════════════════════╗")
    print(f"║  API 缓存代理已启动                       ║")
    print(f"║  监听端口: {PORT}                           ║")
    print(f"║  缓存目录: {CACHE_DIR}")
    print(f"║  缓存文件: {cache_count} 个                    ║")
    print(f"║  转发目标: {TARGET_BASE}")
    print(f"╚══════════════════════════════════════════╝")
    print(f"配置：将base_url改为 http://127.0.0.1:{PORT}/v1")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n代理已停止")
