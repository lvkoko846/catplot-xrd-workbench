# XRED 真实双相 TiO2 系列（公开演示数据）

许可：**MIT**（XRED 数据集，https://github.com/WPEM/XRED）。原始文件未改动，经 GitHub contents API（base64）下载。
下载日期：2026-11-19。波长为推断（Cu Kα λ=1.5406 Å，依据主峰位置），非数据集声明。

## 样品（3 组真实实验双相谱，不同样品/配比）
| 文件 | 仓库路径 | git sha | 点数 | 2θ 范围 |
|---|---|---|---|---|
| tio2-rutile-anatase.csv | biphase/TiO2Rutile Anatase/data.csv | 47c11492a296c777467c26194f9f2ac9ed4aeb7a | 2501 | 10–60 |
| series/Ti-alpha-beta.csv | biphase/Ti-alpha-beta/data.csv | 5d768a53217623f3114a6ae99679f16be88cb6eb | ~2376 | 30–77 |
| series/Ti2448-alpha-beta.csv | biphase/Ti2448-alpha-beta/data.csv | f951e9f0bb6421ac6e508ba276da8f9234df81c6 | ~1998 | 20–60 |

已知物相：锐钛矿 TiO2 + 金红石 TiO2（双相混合物）。各样品主峰位置/相对强度不同（真实差异）。
注意：样品2/3 的锐钛矿(101) 峰不在 24–27° 强峰区，批量该区间会如实记失败原因（不静默跳过）。

## 用途
公开版全功能演示（对比/拟合/批量趋势/粘贴峰表匹配闭环/组会报告），见 scripts/demo-series.mjs。
本目录数据为真实实验谱，**非模拟**；模拟示例另见 web 内置（明确标注）。
