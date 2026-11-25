# 部署说明（公开版 · 纯静态）

> 路线变更（2026-11-18）：放弃服务端/数据库路线。公开版为纯静态前端（无 Node 服务、无 SQLite、无外网调用），
> 可部署于任意静态托管（含 Qoder Sites）或自托管静态服务器。历史的服务端/Sites 后端核查结论见文末附录。

## 产物
`web/` 目录即完整产物（index.html + css/ + js/ + data/example-cards.json + data/demo-spectra.json）。当前实测约 2.4 MB，其中演示数据包约 137 KB；原生格式解析全部在浏览器内完成。
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
3. 示例卡与演示谱许可随条目标注（CC0-1.0/MIT/CC BY 4.0）+ 来源链接与引用文本保留（界面徽标/导出脚注）。
4. GPL-3 的 MiniDIFDUP 与真实 UXD 验收文件只保留在 `tests/fixtures/real/`，不得复制进 `web/`。

## GitHub CI 与视觉回归

`.github/workflows/ci.yml` 在推送 `main`、Pull Request 和手动 `workflow_dispatch` 时运行：
- 真值/模型/原生格式/拟合/批量/匹配/报告测试与公开面审计；
- 桌面和移动浏览器端到端验收；
- `node tests/visual-regression.mjs`：以确定性 SVG 路径哈希、布局边界、文本标签、溢出与弹层状态构成回归基线，避免字体渲染差异导致像素截图误报。

本地维护：
```bash
node scripts/preview.mjs
node tests/visual-regression.mjs
VISUAL_UPDATE=1 node tests/visual-regression.mjs  # 仅在确认是有意改版时使用
git diff -- tests/visual-baseline.json
```
更新基线后必须人工审查差异，并把代码、测试和基线放在同一提交。不要把基线更新当成修复功能回归的快捷方式。

## Zenodo 存档与 DOI

`CITATION.cff` 用于 GitHub/论文引用，`.zenodo.json` 用于 Zenodo 的 GitHub Release 归档。两者同时存在时，Zenodo **只读取 `.zenodo.json`**，所以作者、版本、许可与相关标识必须先在 `.zenodo.json` 中确认。当前作者字段使用公开账号名 `lvkoko846`；正式存档前建议改为 Zenodo 接受的 `Family, Given` 格式并补充 ORCID。

1. 确认 CI 全绿、发布审计 PASS，提交并推送本次增强。
2. 登录 Zenodo，在个人菜单 **GitHub** 中启用仓库 `lvkoko846/catplot-xrd-workbench`，按提示授权 Zenodo 读取仓库与 Releases。
3. 确认 `.zenodo.json` 中的作者、`version: 0.1.0`、`license: mit`、来源仓库与网站标识无误；如需真实姓名/ORCID，先修改、提交、推送并再次跑审计。
4. 在 Zenodo 的 GitHub 页面选择该仓库，点击 **Create release**，创建标签 `v0.1.0` 与对应 GitHub Release；发布说明列出功能、数据许可、测试命令和已知限制。
5. 等待 Zenodo 处理完成，点击自动生成的记录 DOI；在记录页 **External resources → Archived in** 确认 Software Heritage 归档状态。
6. 将 DOI 回填到 `CITATION.cff`（`doi` 字段）与 README 引用区，提交到 `main`；必要时在新 Release 说明中关联该 DOI。Zenodo 已发布版本不可静默改写，后续修改应创建新版本。

论文中应引用具体版本和 DOI，而不是只引用滚动更新的仓库主页。DOI 签发前，README 与引用文件保持“尚未签发”的诚实状态。官方流程见 [Zenodo：归档 GitHub Release](https://help.zenodo.org/docs/github/archive-software/github-upload/) 与 [`.zenodo.json` 元数据](https://help.zenodo.org/docs/github/describe-software/zenodo-json/)。

## 附录：历史服务端路线核查（已废弃）
曾核查 Qoder Sites：单 `app` Edge Function（Deno）、托管 Supabase/Storage、无常驻 Node/SQLite；
故服务端 SQLite 架构不能原样上 Sites。该结论促成最终纯静态路线；服务端代码与受限数据已隔离至仓库外，不随公开版分发。
