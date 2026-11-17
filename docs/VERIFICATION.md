# CatPlot 公开版验证报告（2026-11-18 实测）

环境：Windows 10 x64，Node v24，headless Chrome（CDP）；纯静态服务 `node scripts/preview.mjs`（4173）。
公开版无数据库/无服务端/无外网调用；参考数据为内置公开示例卡（CC0×2 + MIT×1）。
所有结果为实际运行输出；失败与局限如实列于文末。

## 一、剥离与零依赖验证
- 发布面审计 `node scripts/audit-release.mjs`：PASS（无 .db、无 server/、无受限品牌词、无 API 客户端/SQLite 残留）。
- 浏览器实测（browser-public P2）：performance resource 全同源，`/api/` 调用 0、外部请求 0、.db 加载 0。
- 无 package.json/node_modules；index.html 无外部 src/href。
- 功能剥离确认：无匹配页/元素周期表/候选物相页（P1）；检索/匹配/元素/DB 代码与数据隔离至仓库外 quarantine。

## 二、公开示例卡与叠加（browser-public P3/P4、browser-workbench W13）
- 示例卡 3 张：CC0-1.0×2（计算图谱徽标）+ MIT×1（实验谱徽标），来源链接 3/3。
- 加入示例卡 → 独立棒图轨道（laneClip0）渲染；波长确认后按实验波长换算；轨道排序/显隐/手动物相标记生效（W13b–e）。

## 三、峰拟合真值（tests/fit-model.mjs 12/12）
| 场景 | 实测 |
|---|---|
| 单 pseudo-Voigt 无噪声 | 中心/FWHM/面积误差 0（机器精度） |
| 双峰重叠（间距=1×FWHM） | 中心/面积误差 0 |
| 噪声 SNR≈20 | 中心 0.0008°、FWHM 1.54%、Rwp 0.127 |
| 倾斜线性背景+3峰 | 背景系数 [50,30] 精确恢复、Rwp 0 |
| 纯 Gauss/纯 Lorentz | η→0/1 正确、FWHM<1% |
| 峰数远超实际 | 具体报错（degenerate/strong-correlation/not-converged），不返回成功 |
| 中途取消 | ~216ms 终态（≤2s） |
| Scherrer 无仪器宽化 | 表观值+强制警示；扣宽化后 D 增大；仪器≥实测报错 |
| 卡片对照口径 | Δd/Δ2θ 正确；波长不一致只给 d 偏差 |
| 性能 | 30 峰×20001 点 1049ms（<2s）；Node 真值进程 heap 25.4MB/RSS 206.4MB |

## 四、真实谱拟合（XRED 本机 MIT 数据，不联网）
三主峰：拟合中心 25.266/27.402/48.031°，与 PROVENANCE.json 已有数值偏差 0.046/0.018/0.009°；
FWHM 0.4046/0.2678/0.4732°；Rwp 0.0429/0.1108/0.0802。不做含量推断。

## 五、浏览器端到端
- browser-workbench 30/30（BT86 真实谱上传→背景→寻峰→示例叠加→排序/显隐→物相标记→导出→v5 往返）。
- browser-fit 12/12（归一化→原始数据警示、残差子图、Scherrer 警示、取消、示例对照、四类导出、v3 旧档打开+v5 升级、刷新恢复、库版本待更新、390px、零错误）。
- browser-public 9/9（开站即用、零外网、示例徽标、叠加、拟合、导出、v5、v3 兼容、零错误）。
- scripts/mobile-check.mjs：390×844 主图/示例抽屉/拟合页 document.scrollWidth=390 无溢出、零控制台错误（拟合参数表为容器内横向滚动）。
- 截图：scripts/shots/mobile-390*.png、fit-desktop.png、fit-tables-desktop.png、fit-mobile.png（capture-fit）。

## 六、回归通过数总表（串行）
| 套件 | 通过 |
|---|---|
| run-tests | 80/80 |
| browser-workbench | 30/30 |
| browser-fit | 12/12 |
| browser-public | 9/9 |
| fit-model | 12/12 |
| mobile-check | 无溢出/零错误 |
注：公开版裁剪后 run-tests 为 80 项（原 91 项中检索/匹配/本地库相关 11 项随功能剥离移除，新增示例卡核心 3 项与 v5/坏 fit 校验）。

## 七、未完成与局限
- 示例卡仅 3 张（2 计算+1 实验混合物），覆盖有限；无全库检索/匹配/元素筛选（按需求剥离）。
- 计算图谱无温度因子/仪器宽化/择优取向；实验示例 hkl 未指认、波长为推断。
- 拟合标准误为线性近似；优化抽样≤6000 点（质量指标全区间）；不做 Rietveld/定量/面积→含量。
- Scherrer 表观值需仪器宽化才可扣；忽略应变宽化；不与 TEM 粒径等价。
- 浏览器 Worker 堆内存未单列实测（Node 真值进程已测）。
- 公开部署与公开仓库为本轮交付目标（Sites 静态 + git bundle），发布许可以平台确认流程为准。