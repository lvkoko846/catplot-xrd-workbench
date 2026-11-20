# CatPlot 公开版 · 前端模块 API（无服务端）

公开版为**纯静态前端**：无数据库、无服务端 API、无外网调用。参考数据为内置公开示例卡
（`web/data/example-cards.json`，CC0 计算图谱 ×2 + MIT 实验峰表 ×1）。本文档描述浏览器内模块契约。

## CatCards（js/cards.js）
- `STICK_PALETTE`：8 色轨道调色板。
- `braggTwoTheta(d, lambda)`：d(Å)→2θ(°)；d<λ/2 返回 null。
- `loadExamples()`：Promise<doc>，fetch 同源 `data/example-cards.json`（唯一网络请求，同源静态）。
- `makeStick(card, lambda, color)`：→ {key:'ex:'+uid 或 'up:'+uid（source==='upload'）, uid, label, color, lambda, peaks[{d,i,t,hkl[]}], withdrawn:false, converted:false, license, pattern_type, source, source_url, citation, n_peaks}。
- `validateRefs(refs)`：语法校验（key 须 'ex:' 或 'up:' 前缀），返回错误数组。
- `rt`：{sticks[], cards[], doc, index}。

## CatCardsUI（js/cardsui.js）
`openDrawer/closeDrawer/resolveSticks/renderRefs/renderLambda/refreshStatus/previewRemoteUid(uid)/handleCardUpload(files)/ui`。
- `handleCardUpload(files)`：读 CSV/TXT 峰表 → CatMatchCore.parseRefTable 按 '# name=' 分段多卡 → refs.push({key:'up:'+uid, source:'upload', card 内嵌}) → 自动 sticksOn → resolveSticks；坏行给行号原因不入库；状态写 #cardUploadStatus。
- `resolveSticks()`：按 state.refs 构建棒图轨道；upload 引用用内嵌 r.card，示例引用查 rt.cards；未确认实验波长时用卡自身波长；`enabled===false` 跳过。
- 堆叠渲染：CatChart.render/renderExport 读 settings.stack/stackGap/stackScale（≥2 样品生效）；meta 暴露 stack/stackShift/stackScale/syS。
- `ui.remote.status`：{dbVersion:'examples-1', records, offline:true, published:true}（供拟合存档版本标记）。
- 抽屉 DOM：#exStatus/#exList（许可与类型徽标、来源链接、加入按钮）；波长控件 #stickLambdaPreset/#stickLambda/#btnLambdaConfirm；#sticksOn；#refList。

## CatFitCore（js/fitcore.js，fit-1）
`fit(cfg, hooks)` → Promise<result>；cfg={x,y（原始层）,region{min,max},shape, bg{model,coeffs,anchors}, peaks[{c,w,h,sp,locks}]≤30, maxIter}。
result(ok)={ok,algo:'fit-1',shape,bgModel,bgCoeffs,bgSe,region,params[{c,w,h,sp,area,se,locks}],iterations,cost,quality{rwp,rp,chi2red,n,freeParams},note}。
失败 reason 前缀：bad-init / underdetermined / not-converged / ill-conditioned / strong-correlation / degenerate-peaks / cancelled / worker-error（均带具体数值或峰编号）。
`scherrer({fwhm,center,lambda,K,instFwhm})` → {ok,D(Å),beta,apparent,note}；未给仪器宽化 apparent=true 且 note 含「表观值，未扣除仪器宽化，系统性偏小」。
`cardDiff({center,lambda,refD,refT,refLambda})` → {ok,deltaD,deltaT|null,note}；波长不一致 deltaT=null（只给 d 偏差）。
Worker 协议（js/fitworker.js）：主→{id,cfg}|{cancel:true}；Worker→{id,res}；取消≤2s 终态。

## CatFitUI（js/fitui.js）
`refresh/onShow/run/ui`；面板 #toolFit：区间手填/图上框选、背景 5 模型（可先单独拟合）、峰型 4、候选峰（绝对峰高下限）、手动增删/拖动/单参数锁、残差子图、分峰图例、Rwp/Rp/χ²、参数表（标准误/锁）、Scherrer 三模式、示例卡对照表、四类导出。

## CatBatchCore（js/batchcore.js，batch-1，UMD：浏览器/Node）
- `detectPeaks(x,y,{smooth,noiseK,minHeight,minProm,minDist,lo,hi})` → [{c,h}]；复用 CatAnalysis.findPeaks，强制突出度 ≥ noiseK·σ 抗宽峰旁噪声伪峰。
- `buildInitPeaks(x,detected,region,shape)` → 初值 peaks（FWHM≈max(步长×4, 区间/40)）。
- `fitSample(sample,settings,hooks)` → Promise<{ok,params,quality,reason,...}>；恒用 sample.raw；auto 寻峰初值 + **多初值重试**（FWHM 倍数 [1,1.8,0.6,2.6]，抗跨平台浮点差异）；fixed 模式尊重用户初值不重试；每峰附 d/D/Dapparent（Scherrer）。
- `runBatch(samples,settings,hooks{isCancelled,onProgress})` → Promise<{results,settings,at,algo:'batch-1'}>；逐样品串行，失败记原因不中断，取消后续标 cancelled。
- `alignPeaks(batch,{tol,refIndex})` → {anchors[{ref,label,points[{xValue,name,c,w,area,D,Dapparent,d,rwp}]}],tol,refName}；以参考样品峰位为锚，容差内贪心最近匹配。
- `trendCSV(aligned)` / `summaryCSV(batch)` → CSV 字符串。
- settings={region,shape,bg{model},init:'auto'|'fixed',peaks,minHeight,minDist,lambda,K,instrument{mode,fwhm},xMode:'index'|'value',xValues[]}。

## CatBatchUI（js/batchui.js）
`refresh/onShow/ui`；面板 #toolBatch：样品多选（选可见/全选/清空）、共享区间/峰型/背景/寻峰/对齐容差/波长/仪器宽化/K、趋势 X 轴（序号/组分值）、运行/取消/进度条；
趋势图 #batchTrendChart（指标 c/d/w/area/D × 锚点选择，自绘 SVG 折线+点+网格+轴标题）、Scherrer 表观警示、汇总表（含失败原因）、趋势/汇总 CSV + 趋势 PNG/SVG（复用 CatChart 导出）。
批量结果存 state.batch（settings+results），随 checkpoint/save 持久化；onShow 恢复。

## CatMatchCore（js/matchcore.js，pm-2-lite，UMD）
- `parseRefTable(text,{mode,name,lambda,source})` → {ok,card{name,formula,lambda,source,mode,peaks[{d,t,i,hkl}]},errors[行号原因]}；支持 #注释元数据、d/2θ/auto 模式。
- `expFromPeaks(peaks2theta,lam)` → [{idx,t,d,i}]。
- `scoreCandidate(exp,ref,lam,tolT,scan)` / `match(exp,refs,lam,tolT,scan)` → 候选{score,reliable,matched,usableExp,composition{matchFrac,devScore,refCov,weights},pairs,unexplained,missingRef,coveredT}；同分按 matchFrac 排序。
- `coverage(exp,phases,tolT)` → {covered[idx],overlap[idx],remaining[{idx,t,d,i}]}；按峰位跨轮对齐。
- 口径：REF_I_FLOOR=0.01；权重 0.5/0.3/0.2（有 scan）否则 0.625/0.375；可靠=matched≥2∧frac≥0.6∧dev≥0.5∧(refCov≥0.5或无)。

## CatMatchUI（js/matchui.js）
`onShow/ui/runMatch/addRef`；面板 #toolMatch：参考粘贴/加入/移除/示例(TiO2双相)、实验峰来源(寻峰/拟合)、波长/容差、候选表(确认)、已确认物相+覆盖核算、剩余峰续匹配、清空。状态存 state.match{refs,phases}。

## CatReport / CatReportUI（js/report.js / reportui.js，report-1）
- `buildReport(payload)` → 自包含 HTML 字符串；payload={title,generatedAt,mainSvg,trendSvg,samples,fitRegions,batchResults,aligned,match,provenance,limitations,notDone}。
- 七章节：样品与溯源/对比图/峰拟合/批量趋势/匹配闭环/方法脚注/未做待核验；内置诚实口径与 HTML 转义。
- `CatReportUI.collect()/exportReport()`：采集 state+面板 SVG → 下载 catplot-report.html。

## 导出格式
- 峰参数 CSV：peak,center_2theta,d_angstrom,height,fwhm_deg,area,area_relative_percent,eta_or_m,se_center,se_fwhm,se_height,locked
- 组会报告：catplot-report.html（自包含，含内嵌 SVG 与溯源）
- 批量趋势 CSV：series,ref_2theta,x_value,sample,center_2theta,d_angstrom,fwhm_deg,area,D_nm,D_apparent,rwp
- 批量汇总 CSV：index,sample,x_value,ok,n_peaks,rwp,reason
- 曲线 CSV：x_2theta,raw,bg,total_fit,residual
- PNG/SVG：含残差子图与脚注（示例库版本/K/仪器宽化模式/Rwp/「面积占比非物相含量」/不支持 Rietveld 声明）
- 拟合 JSON：{format:'catplot-fit',version:1,algo:'fit-1',library_dbVersion,instrument,K,region,exportedAt}
- 主图 PNG/SVG/CSV：沿用显示层导出（含参考轨道与脚注）。

## 项目存档 v5（js/model.js）
serializeProject/validateProject 支持 version 1–5；v5 含 fit（regions≤8、peaks≤30、区间/参数有限性校验）与 selectedId；**无 match 字段**。
v3/v4 旧档可打开（match 被忽略、fit 为空时提示可升级）；localStorage 键 `catplot.state.v1`，外层 version 5。
示例卡引用 refs：{key:'ex:'+uid, uid, source:'example', label, name, formula, license, pattern_type, enabled}。

## 示例卡数据契约（web/data/example-cards.json）
{format:'catplot-example-cards', library_version:'examples-1', generatedAt, generator, note, cards:[{uid,name,formula,source,source_id,source_url,license,pattern_type,citation,wavelength,calc_params|null,note?,peaks[{d,i,t,hkl|null}],n_peaks,max_i}]}。
生成：`python scripts/build-examples.py`（离线；pymatgen XRDCalculator CuKa/scaled/10–90° + XRED 峰提取）。