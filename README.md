# CatPlot · XRD 分析工作台（公开版）

浏览器本地的 XRD 数值数据分析与绘图工作台：**上传 → 背景扣除 → 寻峰 → 峰拟合 → 出版级导出**。
纯静态、零依赖、零外网调用、无数据库；参考数据为内置**公开许可示例卡**（CC0 计算图谱 ×2 + MIT 实验谱 ×1）。

> 本版为可公开部署/公开仓库版本。含受限许可数据的个人研究完整版另存他处，不随本仓库分发。

## 功能
- 上传 CSV/TXT 数值谱（浏览器本地解析，原始数据不上传、不覆盖）；导入预览/逐行追溯/错误定位。
- 三层数据分离（raw/working/corrected）；显示偏移与归一化仅影响显示，不参与分析。
- SNIP/手动锚点背景（预览→确认→可撤销）；自动寻峰（平滑/σ 阈值/绝对峰高下限/最小峰距）+ 手动标峰；上游变更→峰表「待更新」标记。
- **峰拟合（fit-1）**：选区（手填/图上框选）多区间；背景 无/线性/2–3 阶/锚点折线（可先单独拟合）；
  Gaussian/Lorentz/Pseudo-Voigt/Pearson VII；候选峰复用寻峰、手动增删/拖动初值/单参数锁定；
  Levenberg–Marquardt + 解析 Jacobian + 参数缩放；残差子图、分峰填充与图例开关；
  Rwp/Rp/χ²(red)、参数标准误（线性近似）；Scherrer 表观晶粒尺寸（K 可调；仪器宽化 未提供→强制表观警示 / 固定 FWHM / 标样谱曲线）；
  示例卡峰表对照（Δd/Δ2θ，波长不一致只给 d 偏差）；峰参数 CSV、曲线+残差 CSV、PNG/SVG（含脚注）、拟合 JSON。
- 示例参考卡叠加：独立棒图轨道（共用 X 轴、排序/显隐）、波长确认换算、许可与图谱类型徽标、来源链接。
- 撤销/重做 + 处理历史；项目 v5 本机保存/导出/导入（v1–v4 旧档兼容）；PNG/SVG/三层 CSV 导出（出版级白底、脚注声明）。
- 明确不做：全谱 Rietveld、物相定量、峰面积→质量分数、结构精修；得分/面积占比均非含量或存在概率。

## 快速开始
```bash
node scripts/preview.mjs          # http://127.0.0.1:4173 （或任意静态服务器托管 web/）
python scripts/build-examples.py  # 可选：离线重生成示例卡（需 pymatgen）
```
测试（headless Chrome）：`node tests/run-tests.mjs && node tests/browser-workbench.mjs && node tests/browser-fit.mjs && node tests/browser-public.mjs && node tests/fit-model.mjs && node scripts/mobile-check.mjs`
发布门禁：`node scripts/audit-release.mjs`。

## 目录
- `web/`：完整静态产物（index.html / css / js / data/example-cards.json）
- `scripts/`：预览、示例卡生成、审计门禁、移动端检查、截图取证
- `tests/`：单元/真值/浏览器端到端套件与公开 fixture（XRED MIT 谱 + COD CC0 CIF）
- `docs/`：API（前端模块契约）、FITTING、DATA-SOURCE、VERIFICATION、DEPLOY

## 许可
代码 MIT（LICENSE）。示例数据：COD CC0-1.0、XRED MIT；再分发保留来源链接与引用文本（见 docs/DATA-SOURCE.md）。

## 文档
[docs/API.md](docs/API.md) · [docs/FITTING.md](docs/FITTING.md) · [docs/DATA-SOURCE.md](docs/DATA-SOURCE.md) · [docs/VERIFICATION.md](docs/VERIFICATION.md) · [docs/DEPLOY.md](docs/DEPLOY.md)