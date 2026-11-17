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
- 本目录数据只用于本地测试，不随 web/ 部署。