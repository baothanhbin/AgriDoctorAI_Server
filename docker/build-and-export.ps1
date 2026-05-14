$ErrorActionPreference = "Stop"

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptPath
Push-Location $rootDir

$imageName = "plant-disease-api:latest"
$sourceArchive = "deploy-src.tar.gz"
$runsArchive = "deploy-runs.tar.gz"
$targetHost = "ubuntu@54.173.14.193"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Build and Package For EC2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Checking Docker..." -ForegroundColor Yellow
docker info | Out-Null
Write-Host "[OK]" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Building local API image..." -ForegroundColor Yellow
docker build -t $imageName -f docker/Dockerfile.server .
Write-Host "[OK]" -ForegroundColor Green

Write-Host ""
Write-Host "[3/4] Creating source archives..." -ForegroundColor Yellow
if (Test-Path $sourceArchive) { Remove-Item $sourceArchive -Force }
if (Test-Path $runsArchive) { Remove-Item $runsArchive -Force }
tar -czf $sourceArchive .env.example .dockerignore docker server python
tar -czf $runsArchive runs
Write-Host "[OK]" -ForegroundColor Green
Write-Host "  - $sourceArchive" -ForegroundColor Gray
Write-Host "  - $runsArchive" -ForegroundColor Gray

Write-Host ""
Write-Host "[4/4] Next steps" -ForegroundColor Cyan
Write-Host "Upload archives:" -ForegroundColor White
Write-Host "  scp -C -o ServerAliveInterval=30 -o ServerAliveCountMax=10 $sourceArchive $runsArchive ${targetHost}:~/" -ForegroundColor Yellow
Write-Host ""
Write-Host "On EC2:" -ForegroundColor White
Write-Host "  mkdir -p ~/plant-disease-app" -ForegroundColor Yellow
Write-Host "  tar -xzf ~/deploy-src.tar.gz -C ~/plant-disease-app" -ForegroundColor Yellow
Write-Host "  tar -xzf ~/deploy-runs.tar.gz -C ~/plant-disease-app" -ForegroundColor Yellow
Write-Host "  cp ~/plant-disease-app/docker/docker-compose.prod.yml ~/plant-disease-app/docker-compose.yml" -ForegroundColor Yellow
Write-Host "  cd ~/plant-disease-app" -ForegroundColor Yellow
Write-Host "  cp .env.example .env" -ForegroundColor Yellow
Write-Host "  nano .env" -ForegroundColor Yellow
Write-Host "  docker build -t $imageName -f docker/Dockerfile.server ." -ForegroundColor Yellow
Write-Host "  docker compose --env-file .env up -d" -ForegroundColor Yellow
Write-Host "  docker compose --env-file .env exec api-server npm run seed" -ForegroundColor Yellow

Pop-Location
