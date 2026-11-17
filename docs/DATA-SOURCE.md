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

## 计算参数（计算图谱卡）
pymatgen XRDCalculator：Cu Kα（1.5406 Å）、scaled=True、2θ 10–90°、默认 Lorentz-偏振校正、**无温度因子、无仪器宽化、无择优取向**、symprec=0.1。
生成命令（离线、可复现）：`python scripts/build-examples.py`。

## 已知局限（界面与导出均声明）
- 计算强度与实验强度可能存在系统偏差；示例卡仅供演示与拟合对照，**非物相鉴定结论**。
- 实验示例为混合物峰表，单峰归属未指认。
- 峰面积占比仅标注为「峰面积相对占比，非物相含量」；不做 Rietveld/物相定量。
- Scherrer 未提供仪器宽化时仅给表观值并强制警示。

## 代码许可
源代码 MIT（见根 LICENSE）。示例数据许可随卡标注（CC0-1.0 / MIT），再分发时保留来源链接与引用文本（cards 的 source_url/citation 字段，界面与导出脚注携带）。

## 历史说明
本目录曾含受限许可旧库探索（开放库路由/服务端 SQLite），已于 2026-11-18 全部剥离并隔离至仓库外（F:\Caplot-quarantine，不随公开仓库分发）；个人研究用途的完整版另存 F:\Caplot-jade（禁止公开）。