# 以分离进程启动 CatPlot 预览服务（跨会话存活，不随 agent 会话结束被清理）
$root = "F:\Caplot"
$log = Join-Path $root "preview.log"
$p = Start-Process -FilePath "node" -ArgumentList "scripts/preview.mjs" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError (Join-Path $root "preview.err.log") -PassThru
Write-Output ("started pid " + $p.Id)
