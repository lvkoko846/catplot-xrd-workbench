# CatPlot 公开版 · 前端模块 API（无服务端）

公开版为**纯静态前端**：无数据库、无服务端 API、无外网调用。参考数据为内置公开示例卡
（`web/data/example-cards.json`，CC0 计算图谱 ×2 + MIT 实验峰表 ×1）。本文档描述浏览器内模块契约。

## CatCards（js/cards.js）
- `STICK_PALETTE`：8 色轨道调色板。
- `braggTwoTheta(d, lambda)`：d(Å)→2θ(°)；d<λ/2 返回 null。
- `loadExamples()`：Promise<doc>，fetch 同源 `data/example-cards.json`（唯一网络请求，同源静态）。
- `makeStick(card, lambda, color)`：→ {key:'ex:'+uid, uid, label, color, lambda, peaks[{d,i,t,hkl[]}], withdrawn:false, converted:false, license, pattern_type, source, source_url, citation, n_peaks}。
- `validateRefs(refs)`：语法校验（key 须 'ex:' 前缀），返回错误数组。
- `rt`：{sticks[], cards[], doc, index}。

## CatCardsUI（js/cardsui.js）
`openDrawer/closeDrawer/resolveSticks/renderRefs/renderLambda/refreshStatus/previewRemoteUid(uid)/ui`。
- `resolveSticks()`：按 state.refs 构建棒图轨道；未确认实验波长时用示例卡自身波长（卡含 2θ）；`enabled===false` 的引用跳过。
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

## 导出格式
- 峰参数 CSV：peak,center_2theta,d_angstrom,height,fwhm_deg,area,area_relative_percent,eta_or_m,se_center,se_fwhm,se_height,locked
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