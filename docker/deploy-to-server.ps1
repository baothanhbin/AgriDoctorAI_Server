$ErrorActionPreference = "Stop"

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptPath
Push-Location $rootDir

$ec2Ip = if ($env:EC2_IP) { $env:EC2_IP } else { "54.173.14.193" }
$ec2User = if ($env:EC2_USER) { $env:EC2_USER } else { "ubuntu" }
$appDir = if ($env:APP_DIR) { $env:APP_DIR } else { "~/plant-disease-app" }
$sshKeyPath = if ($env:SSH_KEY_PATH) { $env:SSH_KEY_PATH } else { "" }
$sourceArchive = "deploy-src.tar.gz"
$runsArchive = "deploy-runs.tar.gz"

$sshArgs = @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=10"
)

if ($sshKeyPath -and (Test-Path $sshKeyPath)) {
    $sshArgs += @("-i", $sshKeyPath)
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Upload Deploy Archives To EC2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Host: ${ec2User}@${ec2Ip}" -ForegroundColor Gray
Write-Host ""

if (!(Test-Path $sourceArchive) -or !(Test-Path $runsArchive)) {
    Pop-Location
    throw "Missing deploy archives. Run docker/build-and-export.ps1 first."
}

Write-Host "[1/3] Uploading archives..." -ForegroundColor Yellow
& scp @sshArgs -C $sourceArchive $runsArchive "${ec2User}@${ec2Ip}:~/"
Write-Host "[OK]" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] Extracting on EC2..." -ForegroundColor Yellow
$remoteCommand = @"
mkdir -p $appDir &&
tar -xzf ~/deploy-src.tar.gz -C $appDir &&
tar -xzf ~/deploy-runs.tar.gz -C $appDir &&
cp $appDir/docker/docker-compose.prod.yml $appDir/docker-compose.yml
"@
& ssh @sshArgs "${ec2User}@${ec2Ip}" $remoteCommand
Write-Host "[OK]" -ForegroundColor Green

Write-Host ""
Write-Host "[3/3] Next commands on EC2" -ForegroundColor Cyan
Write-Host "  cd $appDir" -ForegroundColor Yellow
Write-Host "  cp .env.example .env" -ForegroundColor Yellow
Write-Host "  nano .env" -ForegroundColor Yellow
Write-Host "  docker build -t plant-disease-api:latest -f docker/Dockerfile.server ." -ForegroundColor Yellow
Write-Host "  docker compose --env-file .env up -d" -ForegroundColor Yellow
Write-Host "  docker compose --env-file .env ps" -ForegroundColor Yellow
Write-Host "  docker compose --env-file .env logs --tail=100 api-server" -ForegroundColor Yellow
Write-Host "  docker compose --env-file .env exec api-server npm run seed" -ForegroundColor Yellow
Write-Host "  curl http://127.0.0.1:3000/health" -ForegroundColor Yellow
Write-Host "  curl http://$ec2Ip/health" -ForegroundColor Yellow

Pop-Location
