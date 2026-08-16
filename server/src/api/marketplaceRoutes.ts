// server/src/api/marketplaceRoutes.ts
// 技能市场 REST 路由（2026-08-15 生态扩展）。
// 由 unified.ts 以 beforeRoutes 注入网关：返回 true = 已处理（短路主路由）。
// 端点：
//   GET  /api/marketplace/skills              列表（q/category/tag/sort/installedOnly）
//   GET  /api/marketplace/categories          分类 + 标签聚合（供筛选 UI）
//   GET  /api/marketplace/skills/:slug         详情
//   GET  /api/marketplace/remote              远程技能列表（GitHub 联网搜索/浏览）
//   GET  /api/marketplace/remote/config        远程仓库配置（读取）
//   POST /api/marketplace/remote/config        远程仓库配置（更新，需 token）
//   GET  /marketplace                         市场页（web/marketplace.html 静态托管）
//   POST /api/marketplace/skills              发布（publish）
//   POST /api/marketplace/skills/:slug/download   下载远程技能→注册本地（需 token）
//   POST /api/marketplace/skills/:slug/install-remote  一键安装远程技能（下载+安装，需 token）
//   POST /api/marketplace/skills/:slug/install   安装（需 token，若配置）
//   POST /api/marketplace/skills/:slug/uninstall 卸载（需 token，若配置）
//   POST /api/marketplace/skills/:slug/rate       评分

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  listMarketplace, getEntry, categories,
  publishSkill, installSkill, uninstallSkill, rateSkill,
  getRemoteConfig, setRemoteConfig, fetchRemoteSkills, downloadSkill, installRemoteSkill,
} from '../skills/marketplace/registry';

export interface MarketplaceRoutesOptions {
  /** web 静态目录（D:/DaShaAgent/web） */
  webDir: string;
  /** 写操作鉴权 token（AH_MARKETPLACE_TOKEN）；未配置则仅依赖 127.0.0.1 绑定 */
  token?: string;
}

function json200(res: http.ServerResponse, obj: any) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function jsonErr(res: http.ServerResponse, code: number, msg: string) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: msg }));
}
async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}

export function createMarketplaceRoutes(opts: MarketplaceRoutesOptions) {
  const { webDir, token } = opts;

  // 写操作鉴权：配置了 token 则必须匹配（header 或 body）；未配置则放行（依赖 127.0.0.1 网络隔离）
  function authed(req: http.IncomingMessage, body: any): boolean {
    if (!token) return true;
    const h = req.headers['x-marketplace-token'];
    const provided = (typeof h === 'string' ? h : (h && h[0]) || '') || body?.token || '';
    return provided === token;
  }

  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const rawUrl = req.url || '/';
    const url = rawUrl.split('?')[0];
    const qs = rawUrl.includes('?') ? new URLSearchParams(rawUrl.split('?')[1]) : new URLSearchParams();

    // ── 市场页静态托管（path-traversal 安全） ──
    if (req.method === 'GET' && (url === '/marketplace' || url === '/marketplace/')) {
      const fp = path.join(webDir, 'marketplace.html');
      if (fs.existsSync(fp)) {
        try {
          const data = fs.readFileSync(fp);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(data);
          return true;
        } catch { /* fallthrough */ }
      }
      jsonErr(res, 404, 'marketplace.html not found');
      return true;
    }

    // ── 列表 ──
    if (req.method === 'GET' && url === '/api/marketplace/skills') {
      try {
        const list = listMarketplace({
          q: qs.get('q') || undefined,
          category: qs.get('category') || undefined,
          tag: qs.get('tag') || undefined,
          sort: (qs.get('sort') as any) || undefined,
          installedOnly: qs.get('installedOnly') === '1' || qs.get('installedOnly') === 'true',
        });
        json200(res, { count: list.length, skills: list });
      } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }

    // ── 分类/标签聚合 ──
    if (req.method === 'GET' && url === '/api/marketplace/categories') {
      try { json200(res, categories()); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }

    // ── 远程仓库配置（读取）──
    if (req.method === 'GET' && url === '/api/marketplace/remote/config') {
      try { json200(res, getRemoteConfig()); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }
    // ── 远程仓库配置（更新，写操作需 token）──
    if (req.method === 'POST' && url === '/api/marketplace/remote/config') {
      readBody(req).then(async (body: any) => {
        if (!authed(req, body)) { jsonErr(res, 403, 'marketplace token required'); return; }
        try {
          setRemoteConfig({ repos: Array.isArray(body.repos) ? body.repos : [], token: body.token || '' });
          json200(res, { ok: true, config: getRemoteConfig() });
        } catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }
    // ── 远程技能列表（GitHub 联网搜索 / 浏览，缓存 90s）──
    if (req.method === 'GET' && url === '/api/marketplace/remote') {
      fetchRemoteSkills({
        q: qs.get('q') || undefined,
        category: qs.get('category') || undefined,
        force: qs.get('force') === '1',
      }).then((r) => {
        json200(res, { count: r.skills.length, skills: r.skills, errors: r.errors, repos: getRemoteConfig().repos });
      }).catch((e: any) => jsonErr(res, 500, e?.message));
      return true;
    }

    // ── 详情 ──
    const detailM = url.match(/^\/api\/marketplace\/skills\/([^/]+)$/);
    if (req.method === 'GET' && detailM) {
      const slug = decodeURIComponent(detailM[1] || '');
      const e = getEntry(slug);
      if (!e) { jsonErr(res, 404, '技能未找到：' + slug); return true; }
      json200(res, e);
      return true;
    }

    // ── 发布 ──
    if (req.method === 'POST' && url === '/api/marketplace/skills') {
      readBody(req).then(async (body: any) => {
        if (!authed(req, body)) { jsonErr(res, 403, 'marketplace token required'); return; }
        try {
          const entry = await publishSkill({
            slug: body.slug, name: body.name, version: body.version, author: body.author,
            description: body.description, body: body.body, tags: body.tags, category: body.category,
            permissions: body.permissions, trust: body.trust,
          });
          json200(res, { ok: true, entry });
        } catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }

    // ── 下载远程技能（注册到本地注册中心，写操作需 token）──
    const downloadM = url.match(/^\/api\/marketplace\/skills\/([^/]+)\/download$/);
    if (req.method === 'POST' && downloadM) {
      const slug = decodeURIComponent(downloadM[1] || '');
      readBody(req).then(async (body: any) => {
        if (!authed(req, body)) { jsonErr(res, 403, 'marketplace token required'); return; }
        try {
          const entry = await downloadSkill(slug);
          json200(res, { ok: true, entry, dangerFlags: entry.dangerFlags || [] });
        } catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }

    // ── 一键安装远程技能（下载→安装 原子化，写操作需 token）──
    const installRemoteM = url.match(/^\/api\/marketplace\/skills\/([^/]+)\/install-remote$/);
    if (req.method === 'POST' && installRemoteM) {
      const slug = decodeURIComponent(installRemoteM[1] || '');
      readBody(req).then(async (body: any) => {
        if (!authed(req, body)) { jsonErr(res, 403, 'marketplace token required'); return; }
        try {
          const entry = await installRemoteSkill(slug);
          json200(res, { ok: true, entry, dangerFlags: entry.dangerFlags || [] });
        } catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }

    // ── 安装 / 卸载 / 评分 ──
    const actionM = url.match(/^\/api\/marketplace\/skills\/([^/]+)\/(install|uninstall|rate)$/);
    if (req.method === 'POST' && actionM) {
      const slug = decodeURIComponent(actionM[1] || '');
      const action = actionM[2] || '';
      readBody(req).then(async (body: any) => {
        if (action !== 'rate' && !authed(req, body)) { jsonErr(res, 403, 'marketplace token required'); return; }
        try {
          if (action === 'install') {
            const entry = await installSkill(slug);
            json200(res, { ok: true, entry, dangerFlags: entry.dangerFlags || [] });
          } else if (action === 'uninstall') {
            const r = uninstallSkill(slug);
            json200(res, { ok: r.ok, slug });
          } else {
            const entry = rateSkill(slug, Number(body.stars || 0), body.comment, body.by);
            json200(res, { ok: true, entry });
          }
        } catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }

    return false; // 交给 Gateway 主路由
  };
}
