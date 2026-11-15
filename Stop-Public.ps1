$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskStatusPath = Join-Path $taskRoot '.public\status.json'
if (-not (Test-Path -LiteralPath $taskStatusPath)) { Write-Output 'No public session is recorded.'; exit 0 }
$taskStatus = Get-Content -LiteralPath $taskStatusPath -Raw | ConvertFrom-Json
foreach ($taskEntry in @(@{Id=$taskStatus.tunnelProcessId; Match='cloudflared.exe'}, @{Id=$taskStatus.serverProcessId; Match='app.public:app'})) {
    if (-not $taskEntry.Id) { continue }
    $taskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskEntry.Id)
    if ($taskProcess -and $taskProcess.CommandLine.Contains($taskRoot) -and $taskProcess.CommandLine.Contains($taskEntry.Match)) {
        Stop-Process -Id $taskEntry.Id
    }
}
$taskStatus.publicUrl = $null
$taskStatus | ConvertTo-Json | Set-Content -LiteralPath $taskStatusPath
Write-Output 'Public sharing stopped. The original development servers were not changed.'
