Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($p) {
    $cmd = $_.CommandLine
    if ($cmd.Length -gt 120) { $cmd = $cmd.Substring(0, 120) }
    '{0,7}  {1,8:N1} MB  {2}' -f $_.ProcessId, ($p.WorkingSet64 / 1MB), $cmd
  }
}
$db = Get-Item 'F:\Caplot\server\data\catplot.db'
'catplot.db  {0:N2} GiB' -f ($db.Length / 1GB)