# 小红书推广帖（CatPlot 多表征分析工作台）

## 标题（≤20 字，三选一）
1. 研究生救星｜谱图分析打开网页就能做
2. 别再拼Origin了！四表征一个网页搞定
3. 组会前夜救我的免费谱图工作台

## 正文（直接复制）

做催化的研究生谁懂啊：XRD、拉曼、红外、XPS 四套数据，四个软件来回倒，组会前夜还在拼Origin……

后来我把整个流程搬进了一个网页：CatPlot，打开链接就能用，不用安装、不用买许可。

它能把一条谱图从头做到尾：
上传数值文件 → 扣背底 → 自动寻峰 → 分峰拟合 → 峰面积比 / 晶粒尺寸 → 批量趋势 → 一键生成组会报告 → 导出出版级 PNG/SVG。

四个表征通用：
XRD 看物相（还能贴自己的卡片峰表做匹配、上传标准卡片直接画棒图轨道）；
拉曼扣荧光背底算 ID/IG 面积比；
红外做官能团区分峰；
XPS 自动 Shirley 背底 + 荷电校正（C1s 实测→284.8，整谱平移、原始数据不动）+ 化学态面积比。

我最爱它的三点：
1 数据不出浏览器。原始谱只在本机处理，不上传服务器，涉密课题也能用；
2 口径诚实。面积占比≠含量、没扣仪器宽化的晶粒尺寸标「表观值」、匹配得分≠存在概率，全都写在界面上，报告自带方法与局限清单，导师问不倒；
3 多样品纵向堆叠成出版版式，互不重叠，直接进论文/组会PPT。

免费、开源、纯静态，手机电脑都能开。演示用的全是公开数据（XRED、COD、Zenodo），帖子里的图就是在线实测截图。

适合：催化/材料/化学方向研究生、课题组共用、毕设赶图人。
不适合：要做 Rietveld 精修和物相定量的（它明确不做，别误用）。

链接放评论区置顶（小红书正文外链点不动）。搜 CatPlot 也能找到在线版。

#XRD #拉曼光谱 #红外光谱 #XPS #研究生日常 #科研工具 #催化 #Origin替代 #免费科研工具 #组会汇报 #毕业论文 #StudyHack

## 配图顺序（9 张，上传本地文件或用托管 URL）
1. docs/post/images/01-xrd-stack-cards.png —— 封面：堆叠出版版式+卡片轨道（最抓眼球）
2. docs/post/images/02-xrd-fit-residual.png —— 分峰+残差子图
3. docs/post/images/04-raman-fit-ratio.png —— 拉曼 ID/IG 面积比
4. docs/post/images/06-xps-charge-shirley.png —— XPS 荷电校正+Shirley
5. docs/post/images/07-xps-b1s-states.png —— 化学态分峰
6. docs/post/images/05-ftir-drift-peaks.png —— 红外官能团寻峰
7. docs/post/images/09-batch-trend.png —— 批量趋势
8. docs/post/images/08-report.png —— 一键组会报告（含荷电校正列/溯源表）
9. docs/post/images/03-xrd-match-loop.png —— 粘贴峰表匹配闭环

托管 URL 前缀：https://catplot-xrd-ahzrkmiqf3h.qoder.website/post-images/

## 发布提示
- 正文外链不可点：链接 https://catplot-xrd-ahzrkmiqf3h.qoder.website 放评论区置顶 + 个人简介。
- 封面图可加字（平台编辑器）：「四表征一个网页」「数据不出本机」。
- 评论区自顶一条：在线链接 + 开源说明 + 「演示数据均为公开许可，截图为在线实测」。
- 诚实口径保留（面积比≠含量等），避免被专业读者挑错翻车。