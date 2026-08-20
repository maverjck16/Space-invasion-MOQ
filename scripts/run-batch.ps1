<#
.SYNOPSIS
  Esegue N ripetizioni di uno scenario deterministico del testbed (Player A + Player B, stessa
  room), aprendo due finestre Chrome indipendenti per ciascun run ed aspettando che lo scenario
  finisca prima di passare al run successivo. Ogni run produce un file in results/ (vedi
  vite.config.ts, endpoint /api/report) grazie a src/testbed/runLogger.ts. Dopo l'attesa, lo script
  controlla che i 2 file di risultato attesi (uno per player) siano effettivamente comparsi in
  results/ prima di considerare il run riuscito - non si limita piu' ad aprire/chiudere le finestre
  "alla cieca".

.PARAMETER ResultsDir
  Cartella results/ del progetto (contiene i JSON prodotti da /api/report), usata SOLO per la
  validazione post-run. Default: <root progetto>/TS/frontend/results (MoQ) o
  <root progetto>/frontend/results (WebRTC) - individuata automaticamente in base a quale esiste.

.EXAMPLE
  # Testbed MoQ (richiede il relay + il dominio pubblico gia' configurati, vedi TESTBED.md):
  .\scripts\run-batch.ps1 -BaseUrl "https://spaceinvasion.ddns.net" -ScenarioId scenario-1 -Protocol moq -Runs 20

.EXAMPLE
  # Testbed WebRTC (locale, npm run dev sulla porta 5173):
  .\scripts\run-batch.ps1 -BaseUrl "http://localhost:5173" -ScenarioId scenario-1 -Protocol webrtc -Runs 20
#>
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$ScenarioId,
  [Parameter(Mandatory = $true)][ValidateSet("moq", "webrtc")][string]$Protocol,
  [int]$Runs = 1,
  [string]$Room = "",
  [int]$ScenarioDurationMs = 0,
  [int]$BufferMs = 8000,
  [string]$ChromePath = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  [string]$ResultsDir = ""
)

if (-not (Test-Path $ChromePath)) {
  Write-Error "Chrome non trovato in '$ChromePath'. Passa il percorso corretto con -ChromePath."
  exit 1
}

# Individua il file scenario-N.json in locale (stessa macchina che genera lo scenario) per
# ricavare room/durationMs di default, cosi' il comando minimo e' solo "-ScenarioId scenario-1"
# come mostrato in TESTBED.md - entrambi restano comunque sovrascrivibili esplicitamente.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$candidatePublicDirs = @(
  (Join-Path $projectRoot "TS\frontend\public\scenarios"),
  (Join-Path $projectRoot "frontend\public\scenarios")
)
$scenarioFile = $candidatePublicDirs | Where-Object { Test-Path (Join-Path $_ "$ScenarioId.json") } | Select-Object -First 1
if ($scenarioFile) {
  $scenarioJson = Get-Content (Join-Path $scenarioFile "$ScenarioId.json") -Raw | ConvertFrom-Json
  if (-not $Room) { $Room = $scenarioJson.room }
  if ($ScenarioDurationMs -eq 0) { $ScenarioDurationMs = $scenarioJson.durationMs }
} else {
  Write-Warning "File scenario '$ScenarioId.json' non trovato in locale: -Room e -ScenarioDurationMs vanno passati esplicitamente."
}

if (-not $Room) {
  Write-Error "Room non specificata e non ricavabile dal file scenario. Passa -Room esplicitamente."
  exit 1
}
if ($ScenarioDurationMs -eq 0) {
  Write-Error "ScenarioDurationMs non specificata e non ricavabile dal file scenario. Passa -ScenarioDurationMs esplicitamente."
  exit 1
}

if (-not $ResultsDir) {
  $candidateResultsDirs = @(
    (Join-Path $projectRoot "TS\frontend\results"),
    (Join-Path $projectRoot "frontend\results")
  )
  $ResultsDir = $candidateResultsDirs | Where-Object { Test-Path (Split-Path -Parent $_) } | Select-Object -First 1
}

$waitMs = $ScenarioDurationMs + $BufferMs

Write-Host "Eseguo $Runs run di '$ScenarioId' ($Protocol) contro $BaseUrl, room base '$Room' (attesa per run: $($waitMs)ms)`n"

$failedRuns = @()

for ($i = 1; $i -le $Runs; $i++) {
  # Room distinta per ogni ripetizione (evita che run consecutivi si sovrappongano se una finestra
  # impiega piu' del previsto a chiudersi), ma sempre derivata dalla room "canonica" dello scenario.
  $runRoom = if ($Runs -eq 1) { $Room } else { "$Room-r$i" }
  $runId = "$Protocol-$ScenarioId-r$i"

  Write-Host "=== Run $i/$Runs (scenario=$ScenarioId, room=$runRoom) ==="

  $urlA = "$BaseUrl/?auto=1&scenario=$ScenarioId&player=A&room=$runRoom&runId=$runId-A"
  $urlB = "$BaseUrl/?auto=1&scenario=$ScenarioId&player=B&room=$runRoom&runId=$runId-B"

  $resultsCountBefore = 0
  if ($ResultsDir -and (Test-Path $ResultsDir)) {
    $resultsCountBefore = (Get-ChildItem $ResultsDir -Filter "$runId-*.json" -ErrorAction SilentlyContinue | Measure-Object).Count
  }

  # --user-data-dir separato per ciascuna finestra/run: senza, Chrome inoltra l'URL a un'istanza
  # gia' aperta e il processo lanciato da Start-Process esce subito, rendendo impossibile
  # tracciare/interrompere in modo affidabile la finestra corretta a fine run.
  $profileA = Join-Path $env:TEMP "testbed-profile-a-$i-$(Get-Random)"
  $profileB = Join-Path $env:TEMP "testbed-profile-b-$i-$(Get-Random)"

  $procA = Start-Process -FilePath $ChromePath -ArgumentList "--user-data-dir=`"$profileA`"", "--no-first-run", "--no-default-browser-check", "$urlA" -PassThru
  Start-Sleep -Milliseconds 500
  $procB = Start-Process -FilePath $ChromePath -ArgumentList "--user-data-dir=`"$profileB`"", "--no-first-run", "--no-default-browser-check", "$urlB" -PassThru

  Start-Sleep -Milliseconds $waitMs

  foreach ($proc in @($procA, $procB)) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { }
  }
  # Chrome lancia processi figli: ripulisco anche eventuali rimasti con lo stesso user-data-dir.
  Get-Process chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $ChromePath -and ($_.CommandLine -match [regex]::Escape($profileA) -or $_.CommandLine -match [regex]::Escape($profileB)) } |
    ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { } }

  Remove-Item -Recurse -Force $profileA, $profileB -ErrorAction SilentlyContinue

  if ($ResultsDir -and (Test-Path $ResultsDir)) {
    $resultsCountAfter = (Get-ChildItem $ResultsDir -Filter "$runId-*.json" -ErrorAction SilentlyContinue | Measure-Object).Count
    $newFiles = $resultsCountAfter - $resultsCountBefore
    if ($newFiles -lt 2) {
      Write-Warning "Run ${i}: attesi 2 file di risultato (A+B) con prefisso '$runId-', trovati $newFiles. Controllare manualmente (connessione fallita? scenario non completato in tempo?)."
      $failedRuns += $i
    } else {
      Write-Host "Run $i completato: $newFiles file di risultato trovati in results/.`n"
    }
  } else {
    Write-Host "Run $i completato (validazione automatica dei risultati disattivata: cartella results/ non trovata).`n"
  }
}

if ($failedRuns.Count -gt 0) {
  Write-Warning "$($failedRuns.Count)/$Runs run senza risultati completi: $($failedRuns -join ', ')"
} else {
  Write-Host "Tutti i $Runs run completati con risultati validati in results/."
}
