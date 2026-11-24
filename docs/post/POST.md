# 【StudyHack】把催化表征的「画图—扣背底—寻峰—分峰—出报告」搬进浏览器：CatPlot 多表征分析工作台

> **参赛赛道**：Qoder 高校创造力大赛 · StudyHack
> **作者**：太原理工大学 · 化学工程与技术专业 · 催化方向研究生
> **Qoder 账号**：`<请补充你的账号昵称>`（发帖前替换）
> **在线体验**：https://catplot-xrd-ahzrkmiqf3h.qoder.website （纯静态、无需安装、数据不出浏览器）
> **代码与数据**：公开仓库 bundle `CatPlot-public.bundle`（MIT 代码 + CC0/MIT/CC BY 示例数据，溯源见文末）

---

## 一、一句话介绍

CatPlot 是一个**跑在浏览器里的多表征（XRD / 拉曼 / 红外 / XPS）分析工作台**：上传数值谱 → 扣背底 → 寻峰 → 分峰拟合 → 峰面积比 / 表观晶粒尺寸 → 批量趋势 → 一键组会报告 → 出版级 PNG/SVG 导出。全程**原始数据不上传、不覆盖**，无数据库、无后端、无外网依赖，打开链接就能用。

![XRD 堆叠出版版式与公开示例卡轨道](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/01-xrd-stack-cards.png)

*图 1：XRD 多样品纵向堆叠（出版版式，互不重叠），底部为 CC0 计算卡片棒图轨道（标化学式与来源），顶栏可切换表征。*

## 二、为什么做这个

做催化的人每天都在和谱图打交道：XRD 看物相、拉曼看缺陷/石墨化（ID/IG）、红外看官能团、XPS 看化学态。但现实是：

- 商业软件许可贵、安装重，组会前夜还在导数据拼 Origin；
- 免费工具大多只管 XRD，换个表征就要换一套流程；
- 图表口径不统一：背底怎么扣、面积能不能当含量、晶粒尺寸扣没扣仪器宽化，常常没人说清。

我想做一个**口径诚实、四表征通用、打开即用**的工作台：把「分析层 / 显示层 / 原始层」三层数据分开，把每个科学口径写在界面上（面积占比≠含量、Scherrer 未扣仪器宽化=表观值、匹配得分≠存在概率），让组会报告自己带上方法与局限清单。

## 三、开发过程（与 Qoder 协作的真实时间线）

1. **绘图与正确性守卫**：先做出版级 SVG 绘图与 CSV/TXT 解析，随后按 16 条正确性问题清单重建「raw / working / corrected」三层分离、导入逐行追溯、显示偏移不进分析。
2. **参照商业软件口径的分析闭环**：SNIP/手动背底（预览→确认→可撤销）、自动+手动寻峰、上游变更→峰表「待更新」标记、撤销/重做与处理历史、项目存档。
3. **参考库与匹配**：服务端 SQLite 全库索引 + 周期表元素条件 + 峰表匹配（pm-2：一对一占用、参考强峰覆盖、偏差双单位）；浏览器只收峰表不收原始谱。
4. **版权合规分流**：商业卡片库转换数据仅授权个人研究 → 拆出**私人研究版**（禁止公开/参赛）；公开版剥离数据库与检索，仅保留**公开许可示例卡**（COD CC0 计算谱、XRED MIT 实验谱），并加 `audit-release.mjs` 发布门禁（禁 .db/禁受限品牌词/许可白名单）。
5. **峰拟合引擎（fit-1）**：纯 JS Levenberg–Marquardt + 解析 Jacobian + 参数缩放 + 单参数锁定；Gaussian/Lorentz/Pseudo-Voigt/Pearson VII；残差子图、Rwp/Rp/χ²、参数标准误（线性近似）、Scherrer 三模式（未提供仪器宽化强制「表观值」警示）。
6. **多表征通用引擎**：XRD/拉曼/红外/XPS 共用绘图/寻峰/拟合/批量/报告；每表征推荐背底（XPS=Shirley）与流程指南；XPS 荷电校正（参考峰实测→目标，整谱平移、原始数据不动）；分峰面积比面板（ID/IG、化学态比、官能团比）。
7. **批量趋势 + 组会报告 + 视觉精修**：系列样品共享区间逐一套拟合→峰位/FWHM/面积/表观尺寸趋势；自包含 HTML 报告带样品表（含荷电校正列）、溯源表、诚实清单；统一设计令牌、去渐变/发光/重阴影。

**协作方式**：每一批都要求「可操作功能 + 复现步骤 + 实测结果 + 未完成与局限」，用合成真值测试断言恢复精度（而不是用测试数量冒充完成度）。当前回归：单元 80/80、拟合真值 12/12、批量真值 12/12、报告真值 10/10、匹配真值 12/12、浏览器端到端（workbench 30/30、fit 12/12、match 9/9、stack-upload 9/9、public 9/9、techniques 9/9）全绿，移动端 390px 无溢出、零控制台错误。

## 四、全功能演示（全部使用网上公开数据，在线站点实测截图）

### 4.1 XRD：堆叠对比 → 拟合 → 卡片对照 → 匹配闭环

数据：**XRED（MIT）** TiO₂ 金红石+锐钛矿实测混合谱（2501 点，10–60°）；参考卡为 **COD CC0** 计算谱（pymatgen 离线生成）。

![XRD 分峰拟合与残差子图](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/02-xrd-fit-residual.png)

*图 2：选区拟合（24.4–26.3°），红色总拟合 + 填充分峰 + 橙色背底，下方残差子图共享 X 轴；Rwp/Rp/χ² 与参数标准误同屏。*

![XRD 粘贴峰表匹配与确认闭环](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/03-xrd-match-loop.png)

*图 3：无数据库版「物相匹配」——粘贴自有合法参考峰表与实验峰做证据匹配；确认物相后按峰位跨轮对齐覆盖核算，「用剩余未解释峰续匹配」完成多物相闭环。得分是证据合成，不是存在概率。*

另支持：**上传自己的标准衍射卡片 txt**（自动识别卡号/化学式/波长/峰表，不做分析直接成底部棒图轨道、可改名）、多样品堆叠间距/缩放、PNG/SVG/三层 CSV 导出（脚注自动带口径声明）。

### 4.2 拉曼：扣荧光背底 → 分峰 → ID/IG 面积比

数据：**raman-noodles/raman-spectra-decomp-analysis（MIT）** 甲酸分解拉曼谱。

![拉曼分峰与面积比面板](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/04-raman-fit-ratio.png)

*图 4：切换拉曼自动推荐 SNIP 扣荧光背底；分峰后「分峰面积比」面板给出 A/B = 0.253（相对占比，非绝对含量）——ID/IG 的正确口径是面积比，反映缺陷/石墨化程度。*

### 4.3 红外：DRIFT 官能团区寻峰与流程指南

数据：**Zenodo 15180744（CC BY 4.0）** h-BN 氧化脱氢反应后 DRIFT 谱。

![红外 DRIFT 寻峰](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/05-ftir-drift-peaks.png)

*图 5：红外表征推荐手动/自动基线校正；官能团区寻峰后按指南「分峰(官能团区) → 峰面积相对占比(如 C=O/C–O)」，并提示基线影响面积、需统一方法。*

### 4.4 XPS：Shirley 背底 → 荷电校正 → 化学态分峰面积比

数据：同 Zenodo 15180744（CC BY 4.0）h-BN 催化剂 C 1s / B 1s 谱。

![XPS 荷电校正与 Shirley](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/06-xps-charge-shirley.png)

*图 6：切 XPS 自动套用 Shirley 背底；荷电校正面板以实测 C 1s 284.971 eV → 目标 284.8 eV，状态明示「已校正：整谱平移 −0.17 eV…原始数据未改动」。*

![XPS B1s 化学态分峰](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/07-xps-b1s-states.png)

*图 7：B 1s 分峰（B–N ≈190.5 eV / B–O ≈192.5 eV，Rwp 0.024），面积比面板给出化学态相对占比；界面注明绝对定量需灵敏度因子、本工具不做。*

### 4.5 系列批量趋势 + 一键组会报告

![批量趋势](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/09-batch-trend.png)

*图 8：系列样品（模拟系列，已标注）共享区间逐一套拟合，峰位/FWHM/面积/表观晶粒尺寸按参考峰位跨样品对齐成趋势；晶粒尺寸为 Scherrer 表观值并强制警示。*

![组会报告](https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/08-report.png)

*图 9：自包含 HTML 组会报告——样品表含「荷电校正」列、参考/示例数据溯源表（许可+链接）、对比图/趋势图/全峰参数、方法与「未做/待核验」清单。数据仅在本机浏览器处理。*

## 五、数据与许可（全部可公开追溯）

| 用途 | 来源 | 许可 |
|---|---|---|
| XRD 实验混合谱 | XRED（github.com/WPEM/XRED） | MIT |
| XRD 示例参考卡 | COD 1010942 / 1530150（pymatgen 计算） | CC0-1.0 |
| 拉曼演示谱 | raman-noodles/raman-spectra-decomp-analysis | MIT |
| XPS / DRIFT 演示谱 | Zenodo 15180744（h-BN 氧化脱氢） | CC BY 4.0 |
| 批量趋势演示系列 | 由 XRED 谱平移生成 | 模拟，界面已标注 |

计算卡片参数：Cu Kα、scaled、10–90°、默认 LP 校正、**无温度因子/仪器宽化/择优取向**（界面与导出脚注均声明）。

## 六、诚实边界（写在产品里，也写在这里）

- 不做全谱 Rietveld、物相定量（RIR/内标）、峰面积→质量分数、结构精修；
- 峰面积占比 = 相对占比，非含量；匹配得分 = 证据合成，非存在概率；
- Scherrer 未扣仪器宽化 = 表观值（系统性偏小），适用约 1–100 nm、忽略应变、不等价 TEM 粒径；
- 拟合标准误为 Jacobian 协方差线性近似；失败给具体原因（不收敛/强相关/欠定/初值离谱），不静默返回坏结果；
- 含受限许可数据的个人研究完整版**不公开、不参赛**；本参赛版仅含公开许可数据并通过发布审计门禁。

## 七、复现与验证

```bash
node scripts/preview.mjs                 # 本地静态预览（或直接打开在线链接）
node tests/run-tests.mjs                 # 80/80
node tests/fit-model.mjs                 # 拟合真值 12/12
node tests/batch-model.mjs               # 批量真值 12/12
node tests/report-model.mjs              # 报告真值 10/10
node tests/match-model.mjs               # 匹配真值 12/12
node tests/browser-workbench.mjs && node tests/browser-fit.mjs && node tests/browser-match.mjs
node tests/browser-stack-upload.mjs && node tests/browser-public.mjs
node scripts/audit-release.mjs           # 发布门禁 PASS
python scripts/build-examples.py         # 离线重生成 CC0 示例卡
```

在线版与仓库同 commit（4adebd4 系列），发布走 Qoder Sites 既有站点静态发布（webDirectory=web），发布后无缓存强刷逐项验收通过。

## 八、参赛说明

本作品为**公开版**：纯静态、可公开部署、可公开仓库；开发过程全程在 Qoder 内以「分批交付 + 真值验收 + 审计门禁」推进。欢迎评审直接打开在线链接，用文末公开数据复现图 1–图 9 的每一步。

---

*署名：太原理工大学 化学工程与技术 · 催化方向研究生 ｜ Qoder 账号：<请补充>*
*截图均为在线站点实测（headless Chrome 无缓存），数据许可与链接见第五节。*