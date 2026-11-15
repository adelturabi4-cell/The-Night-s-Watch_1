param([int]$Port = 8080)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskStateDirectory = Join-Path $taskRoot '.public'
New-Item -ItemType Directory -Path $taskStateDirectory -Force | Out-Null
$taskBinary = Join-Path $taskStateDirectory 'cloudflared.exe'
$taskHash = 'd5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a'
if (-not (Test-Path -LiteralPath $taskBinary)) {
    Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.11.0/cloudflared-windows-amd64.exe' -OutFile $taskBinary
}
if ((Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskHash) {
    throw 'Cloudflare binary checksum does not match its official release. Nothing was launched.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'frontend\dist\index.html'))) {
    throw 'Build the frontend first: cd frontend; npm run build'
}
$taskStatusPath = Join-Path $taskStateDirectory 'status.json'
if (Test-Path -LiteralPath $taskStatusPath) {
    $taskPrevious = Get-Content -LiteralPath $taskStatusPath -Raw | ConvertFrom-Json
    if ($taskPrevious.tunnelProcessId) {
        $taskPreviousTunnel = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskPrevious.tunnelProcessId)
        if ($taskPreviousTunnel -and $taskPreviousTunnel.CommandLine.Contains($taskBinary) -and $taskPrevious.publicUrl) {
            Write-Output ('Public URL: ' + $taskPrevious.publicUrl)
            exit 0
        }
    }
}
$taskServerProcessId = $null
for ($taskCandidatePort = $Port; $taskCandidatePort -lt $Port + 10; $taskCandidatePort++) {
    $taskListener = Get-NetTCPConnection -LocalPort $taskCandidatePort -State Listen -ErrorAction SilentlyContinue
    if (-not $taskListener) { $Port = $taskCandidatePort; break }
    $taskProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskListener[0].OwningProcess)
    if ($taskProcess -and $taskProcess.CommandLine -and $taskProcess.CommandLine.Contains($taskRoot) -and $taskProcess.CommandLine.Contains('app.public:app')) {
        $Port = $taskCandidatePort
        $taskServerProcessId = $taskProcess.ProcessId
        break
    }
    if ($taskCandidatePort -eq $Port + 9) { throw 'No available port for the public application.' }
}
$taskLocalUrl = 'http://127.0.0.1:' + $Port
if (-not $taskServerProcessId) {
    $taskServer = Start-Process -FilePath (Join-Path $taskRoot 'backend\.venv\Scripts\python.exe') -ArgumentList '-m','uvicorn','app.public:app','--host','127.0.0.1','--port',([string]$Port) -WorkingDirectory (Join-Path $taskRoot 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskStateDirectory 'server.stdout.log') -RedirectStandardError (Join-Path $taskStateDirectory 'server.stderr.log') -PassThru
    $taskServerProcessId = $taskServer.Id
}
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
    try {
        $taskHealth = Invoke-RestMethod -Uri ($taskLocalUrl + '/api/health') -TimeoutSec 2
        if ($taskHealth.status -eq 'ok') { $taskReady = $true; break }
    } catch { Start-Sleep -Milliseconds 400 }
}
if (-not $taskReady) { throw 'The public application did not become ready. See .public/server.stderr.log.' }
$taskActualListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
$taskServerProcessId = $taskActualListener[0].OwningProcess
$taskTunnelLog = Join-Path $taskStateDirectory ('tunnel-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '.log')
$taskTunnel = Start-Process -FilePath $taskBinary -ArgumentList 'tunnel','--no-autoupdate','--url',$taskLocalUrl,'--protocol','http2','--logfile',$taskTunnelLog -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskStateDirectory 'tunnel.stdout.log') -RedirectStandardError (Join-Path $taskStateDirectory 'tunnel.stderr.log') -PassThru
$taskStatus = @{ serverProcessId = $taskServerProcessId; tunnelProcessId = $taskTunnel.Id; localUrl = $taskLocalUrl; publicUrl = $null; log = $taskTunnelLog }
$taskStatus | ConvertTo-Json | Set-Content -LiteralPath $taskStatusPath
for ($taskAttempt = 0; $taskAttempt -lt 60; $taskAttempt++) {
    if (Test-Path -LiteralPath $taskTunnelLog) {
        $taskLogText = Get-Content -LiteralPath $taskTunnelLog -Raw
        $taskMatch = [regex]::Match($taskLogText, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($taskMatch.Success) {
            $taskStatus.publicUrl = $taskMatch.Value
            $taskStatus | ConvertTo-Json | Set-Content -LiteralPath $taskStatusPath
            Write-Output ('Public URL: ' + $taskMatch.Value)
            Write-Output 'Keep this computer and the application running. Stop sharing with Stop-Public.ps1.'
            exit 0
        }
    }
    Start-Sleep -Milliseconds 500
}
throw 'Cloudflare has not returned a URL yet. See .public/tunnel.stderr.log and the tunnel log.'
