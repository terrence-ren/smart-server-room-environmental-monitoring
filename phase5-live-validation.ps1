$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

function Publish-MqttReading {
    param(
        [string]$SensorId,
        [double]$Temperature,
        [bool]$SmokeDetected,
        [string]$Status
    )

    $payload = @{
        sensor_id = $SensorId
        temperature = $Temperature
        humidity = 45.0
        pressure = 1012
        smoke_detected = $SmokeDetected
        water_leak = $false
        status = $Status
    } | ConvertTo-Json -Compress
    $encodedPayload = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes($payload)
    )

    & docker compose exec -T mqtt-broker sh -c "printf '%s' '$encodedPayload' | base64 -d | mosquitto_pub -t 'serverroom/sensors/data' -s"
    if ($LASTEXITCODE -ne 0) {
        throw "MQTT publish failed for sensor $SensorId."
    }
}

function Wait-ForReading {
    param(
        [string]$SensorId,
        [double]$Temperature,
        [bool]$SmokeDetected,
        [string]$Status
    )

    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $result = Invoke-RestMethod -Uri "http://localhost:5001/api/v1/sensors/latest?sensor_id=$SensorId" -Method Get -TimeoutSec 5
            $reading = $result.data
            if (
                $reading.sensor_id -eq $SensorId -and
                [double]$reading.temperature -eq $Temperature -and
                $reading.status -eq $Status -and
                [int]$reading.smoke_detected -eq [int]$SmokeDetected
            ) {
                return $reading
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Expected MQTT reading was not observed for sensor $SensorId."
}

function Wait-ForAlertState {
    param(
        [string]$SensorId,
        [string]$AlertType,
        [string]$Severity,
        [bool]$Resolved
    )

    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $result = Invoke-RestMethod -Uri 'http://localhost:5001/api/v1/alerts?limit=100' -Method Get -TimeoutSec 5
            $alert = $result.data |
                Where-Object {
                    $_.sensor_id -eq $SensorId -and
                    $_.alert_type -eq $AlertType
                } |
                Select-Object -First 1
            if (
                $alert -and
                $alert.severity -eq $Severity -and
                [bool][int]$alert.resolved -eq $Resolved
            ) {
                return $alert
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    $state = if ($Resolved) { 'resolved' } else { 'active' }
    throw "Expected $state $Severity alert '$AlertType' was not observed for sensor $SensorId."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $dockerCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe')
    )
    $dockerExe = $dockerCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if ($dockerExe) {
        $env:Path = "$(Split-Path -Parent $dockerExe);$env:Path"
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host 'Docker is not installed or its CLI could not be found. This validation requires Docker Compose.' -ForegroundColor Red
    exit 1
}

$exitCode = 0
$startedStack = $false

try {
    $runningServices = @(
        & docker compose ps --services --status running |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect Docker Compose services. Check that Docker Engine is running.'
    }

    $requiredServices = @('backend', 'frontend', 'mqtt-broker')
    if ($runningServices.Count -gt 0) {
        $missingServices = @($requiredServices | Where-Object { $_ -notin $runningServices })
        if ($missingServices.Count -gt 0) {
            throw "A partial Compose stack is already running. Start or stop it manually before validation; missing services: $($missingServices -join ', ')."
        }
        Write-Host 'Reusing the already-running Compose stack; it will be left running.' -ForegroundColor Cyan
    }
    else {
        Write-Host 'Starting services with Docker Compose...' -ForegroundColor Cyan
        $startedStack = $true
        & docker compose up --build -d
        if ($LASTEXITCODE -ne 0) {
            throw 'docker compose up failed.'
        }
    }

    Write-Host 'Waiting for backend health endpoint...' -ForegroundColor Cyan
    $backendReady = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri 'http://localhost:5001/health' -Method Get -TimeoutSec 5
            if ($health.status -eq 'ok') {
                $backendReady = $true
                break
            }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }

    if (-not $backendReady) {
        & docker compose ps
        throw 'Backend did not become healthy in time.'
    }

    $sensorId = "phase5-$([guid]::NewGuid().ToString('N'))"
    Write-Host "Testing normal telemetry for sensor $sensorId..." -ForegroundColor Cyan
    Publish-MqttReading -SensorId $sensorId -Temperature 24.5 -SmokeDetected $false -Status 'NORMAL'
    $normalReading = Wait-ForReading -SensorId $sensorId -Temperature 24.5 -SmokeDetected $false -Status 'NORMAL'
    $normalReading | ConvertTo-Json -Depth 6

    Write-Host 'Testing MQTT WARNING alert creation...' -ForegroundColor Cyan
    Publish-MqttReading -SensorId $sensorId -Temperature 30 -SmokeDetected $false -Status 'WARNING'
    $warningReading = Wait-ForReading -SensorId $sensorId -Temperature 30 -SmokeDetected $false -Status 'WARNING'
    $warningAlert = Wait-ForAlertState -SensorId $sensorId -AlertType 'temperature_high' -Severity 'WARNING' -Resolved $false
    $warningAlert | ConvertTo-Json -Depth 6

    Write-Host 'Testing MQTT CRITICAL alert creation...' -ForegroundColor Cyan
    Publish-MqttReading -SensorId $sensorId -Temperature 34 -SmokeDetected $true -Status 'CRITICAL'
    $criticalReading = Wait-ForReading -SensorId $sensorId -Temperature 34 -SmokeDetected $true -Status 'CRITICAL'
    $criticalAlert = Wait-ForAlertState -SensorId $sensorId -AlertType 'smoke_detected' -Severity 'CRITICAL' -Resolved $false
    $criticalAlert | ConvertTo-Json -Depth 6

    Write-Host 'Testing MQTT alert resolution after recovery...' -ForegroundColor Cyan
    Publish-MqttReading -SensorId $sensorId -Temperature 24.5 -SmokeDetected $false -Status 'NORMAL'
    $recoveredReading = Wait-ForReading -SensorId $sensorId -Temperature 24.5 -SmokeDetected $false -Status 'NORMAL'
    $resolvedTemperatureAlert = Wait-ForAlertState -SensorId $sensorId -AlertType 'temperature_high' -Severity 'WARNING' -Resolved $true
    $resolvedSmokeAlert = Wait-ForAlertState -SensorId $sensorId -AlertType 'smoke_detected' -Severity 'CRITICAL' -Resolved $true
    $resolvedTemperatureAlert | ConvertTo-Json -Depth 6
    $resolvedSmokeAlert | ConvertTo-Json -Depth 6

    Write-Host 'RESULT: PASS - MQTT normal/warning/critical telemetry, alert creation, and recovery resolution all verified.' -ForegroundColor Green
}
catch {
    Write-Host "RESULT: FAIL - $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}
finally {
    if ($startedStack) {
        Write-Host 'Stopping the Compose stack started by this script; named volumes are retained.' -ForegroundColor Cyan
        & docker compose down
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'docker compose down failed. Inspect the stack manually; no volumes were requested for removal.' -ForegroundColor Yellow
            $exitCode = 1
        }
    }
}

exit $exitCode
