# CatPlot · XRD 分析工作台（公开版）

浏览器本地的 XRD 数值数据分析与绘图工作台：**上传 → 背景扣除 → 寻峰 → 峰拟合 → 出版级导出**。
纯静态、零依赖、零外网调用、无数据库；参考数据为内置**公开许可示例卡**（CC0 计算图谱 ×2 + MIT 实验谱 ×1）。

> 本版为可公开部署/公开仓库版本。含受限许可数据的个人研究完整版另存他处，不随本仓库分发。

## 功能
- 上传 CSV/TXT 数值谱（浏览器本地解析，原始数据不上传、不覆盖）；导入预览/逐行追溯/错误定位。
- **堆叠出版风格**（≥2 样品默认）：纵向瀑布错开、Intensity (a.u.) 无 Y 刻度、粗黑框、底部卡片棒图轨道；间距/缩放可调、可回退普通模式；随 PNG/SVG 导出。
- **上传我的卡片对比**：支持 ICDD PDF 文本卡片（自动提取卡号/化学式/波长/峰表）与 CSV/TXT 峰表；**不做匹配分析**，直接按上传顺序画成图下方棒图轨道（纵向压缩堆叠），标「化学式 PDF#卡号」、可改名；坏行具体报错；随项目存档与导出。
- **多表征通用引擎**：顶栏切换 XRD/拉曼/红外/XPS；绘图(堆叠)/寻峰/拟合/批量趋势/报告 全表征复用，轴标签按表征切换；d值/Scherrer/卡片/物相匹配 仅 XRD。拟合初值按数据步长自适应。
- **每表征背景与分析流程**：背景三模型 SNIP（XRD/拉曼荧光背底）/ **Shirley**（XPS 非弹性背底，左侧累积峰面积正比）/ 手动锚点（红外基线）；切换表征自动套用推荐背景；拟合页显示该表征推荐流程；分峰面积比面板（拉曼 ID/IG、XPS 化学态比、红外官能团比，均标注相对占比非绝对含量）。
- 三层数据分离（raw/working/corrected）；显示偏移与归一化仅影响显示，不参与分析。
- SNIP/手动锚点背景（预览→确认→可撤销）；自动寻峰（平滑/σ 阈值/绝对峰高下限/最小峰距）+ 手动标峰；上游变更→峰表「待更新」标记。
- **峰拟合（fit-1）**：选区（手填/图上框选）多区间；背景 无/线性/2–3 阶/锚点折线（可先单独拟合）；
  Gaussian/Lorentz/Pseudo-Voigt/Pearson VII；候选峰复用寻峰、手动增删/拖动初值/单参数锁定；
  Levenberg–Marquardt + 解析 Jacobian + 参数缩放；残差子图、分峰填充与图例开关；
  Rwp/Rp/χ²(red)、参数标准误（线性近似）；Scherrer 表观晶粒尺寸（K 可调；仪器宽化 未提供→强制表观警示 / 固定 FWHM / 标样谱曲线）；
  示例卡峰表对照（Δd/Δ2θ，波长不一致只给 d 偏差）；峰参数 CSV、曲线+残差 CSV、PNG/SVG（含脚注）、拟合 JSON。
- **系列样品批量分析 + 趋势（batch-1）**：选一组样品 + 共享 2θ 区间，逐样品拟合（恒用 raw 层），跨样品按参考峰位对齐；
  峰位 / d / FWHM / 积分面积 / 表观晶粒尺寸 随样品序号或组分值的趋势图；失败样品给具体原因不静默跳过、可取消；
  auto 模式多初值重试抗跨平台浮点差异；趋势/汇总 CSV + 趋势 PNG/SVG 导出。面向掺杂/焙烧温度等系列样品的日常分析。
- **物相匹配·粘贴峰表（pm-2-lite）**：无内置库，粘贴自有参考峰表（d-I-hkl/2θ-I-hkl）与实验峰证据匹配；
  参考<1%弱峰不配对、一对一占用、得分非存在概率；确认物相→覆盖核算（按峰位跨轮对齐）→剩余峰续匹配（多物相闭环）。
- **一键组会报告**：自包含 HTML（对比图+趋势+峰参数+匹配闭环+方法脚注+数据溯源+未做/待核验诚实清单）。
- 示例参考卡叠加：独立棒图轨道（共用 X 轴、排序/显隐）、波长确认换算、许可与图谱类型徽标、来源链接。
- 公开真实演示：XRED（MIT）3 组真实双相 TiO2 系列，`node scripts/demo-series.mjs` 全功能取证。
- 撤销/重做 + 处理历史；项目 v5 本机保存/导出/导入（v1–v4 旧档兼容）；PNG/SVG/三层 CSV 导出（出版级白底、脚注声明）。
- 明确不做：全谱 Rietveld、物相定量、峰面积→质量分数、结构精修；得分/面积占比均非含量或存在概率。

## 快速开始
```bash
node scripts/preview.mjs          # http://127.0.0.1:4173 （或任意静态服务器托管 web/）
# 若浏览器显示旧版/连不上：预览服务是本地进程，会话结束可能被系统回收。重启上述命令后刷新即可（服务设 no-store，无缓存）。
python scripts/build-examples.py  # 可选：离线重生成示例卡（需 pymatgen）
```
测试（headless Chrome）：`node tests/run-tests.mjs && node tests/browser-workbench.mjs && node tests/browser-fit.mjs && node tests/browser-public.mjs && node tests/fit-model.mjs && node tests/batch-model.mjs && node tests/browser-batch.mjs && node tests/match-model.mjs && node tests/browser-match.mjs && node tests/report-model.mjs && node tests/browser-report.mjs && node scripts/mobile-check.mjs`
真实系列演示：`node scripts/demo-series.mjs`（XRED MIT 3 样品，产出截图+组会报告）。
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