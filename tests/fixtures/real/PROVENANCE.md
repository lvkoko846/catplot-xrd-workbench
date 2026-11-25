# 真实实验谱图（验收用）

- 文件：BT86_xrd.txt（两列：2θ / 计数，制表符分隔，2374 点，3.000–40.000°）
- 原始文件：BT86_.UXD（Bruker Diffrac Plus UXD 格式，未改动）
- 来源：xylib 开源项目示例数据（公有仓库，MIT/LGPL 许可的测试样本）
  https://github.com/wojdyr/xylib/blob/master/samples/BT86_.UXD
  经 GitHub API 下载（2026-11-16），仅提取 `_2THETACOUNTS` 之后的数据段，数值未做任何修改。
- 仪器元数据（摘自 UXD 文件头）：
  - 样品名 BT86，测量单位 Department of Chemistry
  - 测量时间 04-Mar-2010 20:59:14
  - Cu 靶，λ1 = 1.5406 Å（Kα1），λ2 = 1.54439 Å，Kα2/Kα1 = 0.5
  - 45 kV / 40 mA，步长 0.015592°，每步 0.5 s，耦合扫描（COUPLED）
  - 发散狭缝 0.15 mm（固定），防散射狭缝 12.38 mm
- 物相未由本仓库标定；用于走通「导入→背景→寻峰→导出→保存恢复」全流程。
- 文件：`MiniDIFDUP.JDX`（JCAMP-DX 4.24，584 点，2373.973–1804.104 cm⁻¹）
- 来源：readJDX 开源项目的 `inst/extdata/MiniDIFDUP.JDX`
  https://github.com/bryanhanson/readJDX/blob/main/inst/extdata/MiniDIFDUP.JDX
  经 GitHub 原始文件下载（2026-11-25），内容未做数值修改。
- 文件头许可：GPL-3；由 B. Hanson 根据 IUPAC `BRUKER1.JCM` 修改。
- 真值元数据：`FIRSTX/LASTX`、`FIRSTY`、`MINY/MAXY`、`NPOINTS`；覆盖 SQZ/DIF/DIFDUP 与 X/Y 因子缩放。
- 本目录数据只用于本地测试，不随 web/ 部署。

## 厂商原生格式的公开回归 fixture

`tests/vendor-fixtures.mjs` 以固定数值程序生成 XRDML、RAS 与 SPA 二进制样本；这些是测试代码，不是厂商实验谱，也不包含第三方受限数据。

- XRDML：覆盖默认/前缀命名空间、单测量与多轴、`listPositions`/起止轴/共同轴、显式强度优先、`counts × beamAttenuationFactors`、长度不一致、坏 XML 与实体声明拒绝。
- RAS：覆盖两列/三列强度策略、正计数因子、坏行物理行号、声明点数冲突与区段标记拒绝。
- SPA：覆盖键表、float32 载荷、Last X→First X 定向、有限值/边界/点数校验、单位、拉曼元数据，以及截断、重复块、干涉图、未知单位和库检索变体拒绝。
- 可复现命令：`node tests/native-formats.mjs` 与 `node tests/browser-demo-native.mjs`（浏览器套件需先启动本地 4173 预览）。

## 本地真实文件兼容性核对（2026-11-25，文件不入库）

以下文件仅下载到系统临时目录做兼容性核对；未判定或确认再分发许可，因此不复制进仓库、不随 `web/` 部署。

- PANalytical XRDML：FAIRmat-NFDI/readers-xrd 的 `10_m84325_C_XRR_fast_processed.xrdml`。
  浏览器导入 399 点，2Theta 0.2100–4.1900°；样品 m778；Cu Kα1 1.540598 Å；40 kV / 40 mA；`counts × beamAttenuationFactors` 后首/第二/末强度为 97350 / 104429 / 8；仅逻辑记录号，项目存档校验通过。
  来源：https://github.com/FAIRmat-NFDI/readers-xrd/blob/main/tests/data/10_m84325_C_XRR_fast_processed.xrdml
- Rigaku RAS：thomasgredig/rigakuXRD 的 `MB120718Si3.ras`。
  导入 1,401 点，2.0000–30.0000°；样品 MB120718Si3；Cu Kα1 1.540593 Å；40 kV / 44 mA；首/末点位于原文件 327 / 1727 行，三列计数因子策略生效，零错误。
  来源：https://github.com/thomasgredig/rigakuXRD/blob/master/inst/extdata/MB120718Si3.ras
- OMNIC SPA：spectrochempy 示例目录的 `spectre.SPA` 与 `interfero.SPA`。
  `spectre.SPA` 解码为 3,734 点、400.163452–3999.706055 cm⁻¹ 单光束谱；`interfero.SPA` 的 X 单位为 data points，被明确拒绝为独立干涉图，未导入任何点。
  来源目录：https://github.com/spectrochempy/spectrochempy/tree/master/docs/data/irdata/interferogram