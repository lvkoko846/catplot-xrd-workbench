# 数据来源与许可说明（公开版）

公开版**不含任何受限许可数据**：无商业卡片库转换数据、无数据库文件、无服务端。参考数据仅为以下公开示例卡。

## 示例卡清单（web/data/example-cards.json，library_version=examples-1）
| uid | 名称 | 来源 | 许可 | 类型 | 峰数 |
|---|---|---|---|---|---|
| COD-1010942 | Anatase（锐钛矿 TiO2） | COD 1010942 | CC0-1.0 | 计算图谱 | 18 |
| COD-1530150 | Rutile（金红石 TiO2） | COD 1530150 | CC0-1.0 | 计算图谱 | 20 |
| XRED-TiO2-mix | TiO2 金红石+锐钛矿混合物 | XRED（GitHub WPEM/XRED） | MIT | 实验谱 | 9 |

- COD 条目：https://www.crystallography.net/cod/1010942.html 、 https://www.crystallography.net/cod/1530150.html （CC0-1.0，可自由再分发）。
  本地 CIF 副本：tests/fixtures/real-xred/1010942.cif、1530150.cif。
- XRED：MIT 许可实验数据集；data.csv git sha 47c11492a296c777467c26194f9f2ac9ed4aeb7a；本地副本 tests/fixtures/real-xred/tio2-rutile-anatase.csv（2501 点 10–60°）。
  实验峰表由原始谱局部极大提取（hkl 未指认）；波长 λ=1.5406 为峰位推断（Cu Kα），非数据集声明，已在卡 note 声明。

## 四表征公开演示谱（web/data/demo-spectra.json）

| id | 表征 | 数据 | 点数 | 许可 |
|---|---|---|---:|---|
| xred-tio2 | XRD | XRED TiO₂ 金红石+锐钛矿实验谱 | 2501 | MIT |
| raman-formic-acid | 拉曼 | Raman Noodles 甲酸分解拉曼谱 | 1941 | MIT |
| drift-spent-hbn | 红外 | Zenodo 15180744 反应后 h-BN DRIFT | 3475 | CC BY 4.0 |
| xps-c1s-hbn | XPS | Zenodo 15180744 C 1s | 481 | CC BY 4.0 |
| xps-b1s-hbn | XPS | Zenodo 15180744 B 1s | 561 | CC BY 4.0 |

- Raman Noodles：https://github.com/raman-noodles/raman-spectra-decomp-analysis
- Zenodo 15180744：https://zenodo.org/records/15180744 （Low-temperature oxidation of hexagonal boron nitride during oxidative dehydrogenation）
- 演示包由 `node scripts/build-demo-data.mjs` 从仓库内已留存的公开数据确定性生成；每条记录保留 `source_url`、`citation`、`license`、单位、推荐背景与寻峰参数。
- 加载演示会替换当前工作项目，但生成撤销检查点；`raw` 数组不被背景、荷电校正、归一化或显示偏移改写。模拟 XRD 为固定种子程序生成，单独标识，不计入上述真实实验谱。

## 原生格式验收样本（仅 tests/，不部署）

- `BT86_.UXD`：xylib 示例数据，2374 点；与独立提取的 `BT86_xrd.txt` 逐点比对。来源与仪器元数据见 `tests/fixtures/real/PROVENANCE.md`。
- `MiniDIFDUP.JDX`：readJDX 示例，GPL-3，584 点；覆盖 SQZ/DIF/DIFDUP 与 X/Y 因子。该文件头 `MAXY/MINY` 与解码数据不一致，CatPlot 将其作为元数据冲突告警，不改写解码值；X 坐标在 FIRSTX/LASTX/NPOINTS 完整且点数匹配时按标准端点重建，并报告与 DELTAX 的差异。
- XRDML / RAS / SPA：由 `tests/vendor-fixtures.mjs` 确定性生成公开合成 fixture，覆盖正常解码、单位/因子、元数据、坏输入与截断；不把真实厂商文件放入仓库。真实 XRDML、RAS、SPA 光谱及 SPA 干涉图仅在系统临时目录做本地兼容性核对，结果与来源见 `tests/fixtures/real/PROVENANCE.md`。
- RAS 三列文件的第 3 列按正计数因子处理，测量强度为第 2 列 ÷ 第 3 列；两列文件直接取第 2 列。RASX 是 ZIP 容器，暂不支持。SPA 只接收已验证单谱布局，拒绝干涉图、库检索变体、未知单位/布局及截断文件。

## 计算参数（计算图谱卡）
pymatgen XRDCalculator：Cu Kα（1.5406 Å）、scaled=True、2θ 10–90°、默认 Lorentz-偏振校正、**无温度因子、无仪器宽化、无择优取向**、symprec=0.1。
生成命令（离线、可复现）：`python scripts/build-examples.py`。

## 已知局限（界面与导出均声明）
- 计算强度与实验强度可能存在系统偏差；示例卡仅供演示与拟合对照，**非物相鉴定结论**。
- 实验示例为混合物峰表，单峰归属未指认。
- 峰面积占比仅标注为「峰面积相对占比，非物相含量」；不做 Rietveld/物相定量。
- Scherrer 未提供仪器宽化时仅给表观值并强制警示。

## 代码许可
源代码 MIT（见根 LICENSE）。部署数据许可随条目标注（CC0-1.0 / MIT / CC BY 4.0），再分发时保留来源链接与引用文本（界面与导出脚注携带）。GPL-3 的 MiniDIFDUP 样本只用于仓库测试，不进入 `web/`。

## 历史说明
本目录曾含受限许可旧库探索（开放库路由/服务端 SQLite），已于 2026-11-18 全部剥离并隔离至仓库外（F:\Caplot-quarantine，不随公开仓库分发）；个人研究用途的完整版另存 F:\Caplot-jade（禁止公开）。