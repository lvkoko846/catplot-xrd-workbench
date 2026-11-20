# 部署说明（公开版 · 纯静态）

> 路线变更（2026-11-18）：放弃服务端/数据库路线。公开版为纯静态前端（无 Node 服务、无 SQLite、无外网调用），
> 可部署于任意静态托管（含 Qoder Sites）或自托管静态服务器。历史的服务端/Sites 后端核查结论见文末附录。

## 产物
`web/` 目录即完整产物（index.html + css/ + js/ + data/example-cards.json）。实测体积 < 1 MB（示例卡 6.9 KB）。
无构建步骤、无依赖安装；直接托管即可。

## 本地预览
```bash
node scripts/preview.mjs        # 127.0.0.1:4173，纯静态
# 或任意静态服务器，如：python -m http.server 4173 --directory web
```

## 自托管静态（示例 nginx）
```nginx
server {
  listen 80;
  server_name catplot.example.org;
  root /var/www/catplot/web;
  index index.html;
  location / { try_files $uri $uri/ =404; }
  add_header Cache-Control "no-store";   # 示例卡与代码更新即时生效；如需缓存可按文件名哈希改策略
}
```
成本：任意静态主机/对象存储+CDN（近乎零边际成本）；无服务器运维、无数据库备份。

## Qoder Sites 静态发布
- 约束核查（历史）：Sites 不支持常驻 Node 进程与 SQLite 文件；单文件 ≤50 MiB、Web 原始 ≤450 MiB、Worker 产物 ≤50 MiB。
  公开版纯静态、产物 <1 MB，完全满足；不需要 Edge Function/托管 DB。
- 流程：sites-building 准备（webDirectory=web）→ sites-hosting 发布确认 → 公开链接。发布前必须通过 `node scripts/audit-release.mjs`。

### 每次更新同步到公开站点（固定流程）
公开站点托管在 Qoder Sites，发布动作需在 Qoder 内触发（本仓库无 Sites CLI）。每次功能更新后：
1. 本地验证：全套测试绿 + `node scripts/audit-release.mjs` PASS（公开面一律中性表述，受限品牌词不得出现）。
2. 提交：`git add web scripts docs tests README.md .gitignore && git commit`（沿用仓库作者身份）。
3. 在 Qoder 打开本项目 → Sites 发布（projectRoot=仓库根、webDirectory=web）→ 确认发布到既有 siteId（描述符见根目录 .CatPlot*.qoder.site）。
4. 打开公开链接 Ctrl+F5 验证新功能（Sites 若带缓存需强刷）。
> 注意：本地 `node scripts/preview.mjs` 只是本地预览，不等于公开站点；公开站点必须经第 3 步重新发布才会更新。

## 发布门禁
1. `node scripts/audit-release.mjs` PASS（无 .db/无 server/无受限品牌/无 API 客户端残留）。
2. 全套测试绿（docs/VERIFICATION.md 第六节）。
3. 示例数据许可随卡标注（CC0-1.0/MIT）+ 来源链接与引用文本保留（界面徽标/导出脚注）。

## 附录：历史服务端路线核查（已废弃）
曾核查 Qoder Sites：单 `app` Edge Function（Deno）、托管 Supabase/Storage、无常驻 Node/SQLite；
故服务端 SQLite 架构不能原样上 Sites。该结论促成最终纯静态路线；服务端代码与受限数据已隔离至仓库外，不随公开版分发。