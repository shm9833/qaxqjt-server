/**
 * qaxqjt-proxy (Cloudflare Worker)
 * 用途：qaxqjt.cn / www / api 三入口边缘反代到腾讯云源站 1.14.106.173
 * 背景：域名未完成ICP备案，腾讯云机房对 80 端口 Host 为未备案域名的请求
 *       注入 302 跳转 dnspod webblock。Worker 回源时把 Host 改写为源站 IP，
 *       nginx 默认 server 即为本站，可正常服务，从而绕过域名拦截（零服务器改动）。
 * 部署：Cloudflare 账户级 Worker qaxqjt-proxy production
 * 路由：qaxqjt.cn/*  www.qaxqjt.cn/*  api.qaxqjt.cn/*
 *       （console.qaxqjt.cn/* 由 qaxqjt-console 独立承接，勿改动）
 */

const ORIGIN = "http://1.14.106.173";
const ORIGIN_HOST = "1.14.106.173";

// 逐跳透传时必须剥离的 hop-by-hop / 会被 fetch 重算的头
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "trailer",
  "upgrade",
  "x-application-context",
  "accept-encoding",
  "content-length",
  "host",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cdn-loop"
];

const RESPONSE_DROP = ["content-encoding", "content-length", "transfer-encoding", "connection"];

export default {
  async fetch(request) {
    const u = new URL(request.url);

    // 临时诊断路由（验证后删除）
    if (u.searchParams.has("__wdbg")) {
      const port = u.searchParams.get("__port") || "80";
      const path = u.searchParams.get("__path") || u.pathname;
      const t = new URL(path, `http://${ORIGIN_HOST}:${port}`);
      const dbg = { incomingHost: u.host, target: t.toString(), targetHostHeader: ORIGIN_HOST };
      try {
        const probe = await fetch(t.toString(), {
          method: "GET",
          headers: { Host: ORIGIN_HOST },
          redirect: "manual"
        });
        const txt = await probe.text();
        dbg.probe = {
          status: probe.status,
          srv: probe.headers.get("server"),
          ct: probe.headers.get("content-type"),
          bodyHead: txt.substring(0, 120)
        };
      } catch (e) {
        dbg.probeErr = String(e);
      }
      return new Response(JSON.stringify(dbg, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const target = new URL(u.pathname + u.search, ORIGIN);

    const h = new Headers();
    for (const [k, v] of request.headers) {
      if (HOP_BY_HOP.indexOf(k.toLowerCase()) === -1) h.set(k, v);
    }
    h.set("Host", ORIGIN_HOST);
    h.set("X-Forwarded-Host", u.host);
    h.set("X-Forwarded-Proto", "https");
    const cfIp = request.headers.get("CF-Connecting-IP");
    if (cfIp) h.set("X-Real-IP", cfIp);

    const init = { method: request.method, headers: h, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    let resp;
    try {
      resp = await fetch(target.toString(), init);
    } catch (e) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: { code: "ORIGIN_FETCH_FAIL", message: String(e) }
        }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const out = new Headers();
    for (const [k, v] of resp.headers) {
      if (RESPONSE_DROP.indexOf(k.toLowerCase()) === -1) out.set(k, v);
    }
    // 若源站返回跳转（理论上不跳），把 Location 修回正式域名
    const loc = out.get("Location");
    if (loc) {
      out.set("Location", loc.split(ORIGIN).join("https://" + u.host));
    }

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: out
    });
  }
};
