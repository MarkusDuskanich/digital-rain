# Measures what an SVG rain costs the browser: opens it in a private Microsoft Edge app
# window, as the desktop draws it, and prints that Edge's CPU (all its processes, in % of
# one core) over -Seconds after -Warm, then closes it. The window must stay visible.
#   powershell -ExecutionPolicy Bypass -File bench\bench.ps1 -Svg rain.svg [-Width 1400] [-Runs 3]
# The SVG file must sit in this folder (the page fetches it next to itself).
param([string]$Svg, [int]$Width = 1400, [int]$Runs = 3, [int]$Warm = 8, [int]$Seconds = 20)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$edgeProfile = Join-Path $env:TEMP 'digital-rain-bench-edge'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$url = 'file:///' + $dir.Replace([char]92, [char]47) + '/page.html#' + $Svg + '|' + $Width

function Snapshot {
  $times = @{}
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*digital-rain-bench-edge*' } | ForEach-Object {
    $type = 'browser'; if ($_.CommandLine -match '--type=([\w-]+)') { $type = $Matches[1] }
    $times[$_.ProcessId] = @{ Type = $type; Seconds = ($_.KernelModeTime + $_.UserModeTime) / 1e7 }
  }
  $times
}

function StopEdge {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*digital-rain-bench-edge*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
}

StopEdge
$totals = @()
foreach ($run in 1..$Runs) {
  $arguments = @("--user-data-dir=$edgeProfile", "--app=$url", "--window-size=$($Width + 80),260", '--window-position=0,0',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
    # Keep drawing when another window covers it.
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding')
  $null = Start-Process $edge -PassThru -ArgumentList $arguments
  Start-Sleep -Seconds $Warm
  $before = Snapshot; $start = Get-Date
  Start-Sleep -Seconds $Seconds
  $after = Snapshot; $elapsed = ((Get-Date) - $start).TotalSeconds
  $byType = @{}; $total = 0
  foreach ($id in $after.Keys) {
    if (-not $before.ContainsKey($id)) { continue }
    $share = ($after[$id].Seconds - $before[$id].Seconds) / $elapsed * 100
    $total += $share; $byType[$after[$id].Type] = $byType[$after[$id].Type] + $share
  }
  StopEdge
  $totals += $total
  $parts = ($byType.GetEnumerator() | Where-Object { $_.Value -ge 0.5 } | Sort-Object Name | ForEach-Object { "$($_.Name) $([math]::Round($_.Value))" }) -join ', '
  '{0} run {1}: {2:N0}% ({3})' -f $Svg, $run, $total, $parts
}
'{0}: mean {1:N0}% of one core over {2} runs' -f $Svg, ($totals | Measure-Object -Average).Average, $Runs
