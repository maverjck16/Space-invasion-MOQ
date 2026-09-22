<#
.SYNOPSIS
  Esegue N ripetizioni di uno scenario deterministico del testbed (Player A + Player B, stessa
  room), aprendo due finestre Chrome indipendenti per ciascun run ed aspettando che la partita
  finisca prima di passare al run successivo. Ogni run produce un file in results/ (vedi
  vite.config.ts, endpoint /api/report) grazie a src/testbed/runLogger.ts.

  TESTBED 1v1: la partita automatica non ha una durata fissa (una sola vita per giocatore, nessun
  timer: finisce quando entrambi sono eliminati o poco dopo l'ultima ondata). Per questo lo script
  non aspetta un tempo prefissato ma controlla ogni secondo la cartella results/: il run e' concluso
  appena compaiono i 2 file di risultato attesi (uno per player), che i client salvano quando la
  partita ha un esito. Se non compaiono entro -MaxWaitMs il run viene segnalato come incompleto.

.PARAMETER ScenarioDurationMs
  Lunghezza della timeline di input dello scenario (campo "durationMs", letto dal file scenario se
  non indicato). Serve solo a calcolare l'attesa massima di default.

.PARAMETER MaxWaitMs
  Attesa massima per ogni run, in ms. Default: ScenarioDurationMs + 60000.

.PARAMETER BufferMs
  Attesa usata solo se la cartella results/ non e' disponibile per il controllo (in quel caso lo
  script aspetta ScenarioDurationMs + BufferMs, come nelle versioni precedenti).

.PARAMETER ResultsDir
  Cartella results/ del progetto (contiene i JSON prodotti da /api/report), usata SOLO per la
  validazione post-run. Default: <root progetto>/TS/frontend/results (MoQ) o
  <root progetto>/frontend/results (WebRTC) - individuata automaticamente in base a quale esiste.

.EXAMPLE
  # Testbed MoQ (richiede il relay + il dominio pubblico gia' configurati, vedi TESTBED.md):
  .\scripts\run-batch.ps1 -BaseUrl "https://spaceinvasion.ddns.net" -ScenarioId scenario-1 -Protocol moq -Runs 20

.EXAMPLE
  # Testbed WebRTC: signaling+TURN deployati sulla VM (docker compose, vedi deploy/DEPLOY.md),
  # ma frontend in locale via "npm run dev:frontend" (porta 5173) - richiesto perche' solo il dev
  # server Vite espone l'endpoint /api/report che questo script usa per rilevare la fine di ogni
  # run (vedi TESTBED.md, sezione "Come avviare un test"); il traffico di rete misurato resta
  # comunque quello verso signaling/TURN remoti, indicati in frontend/src/config.ts.
  .\scripts\run-batch.ps1 -BaseUrl "http://localhost:5173" -ScenarioId scenario-1 -Protocol webrtc -Runs 20
#>
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$ScenarioId,
  [Parameter(Mandatory = $true)][ValidateSet("moq", "webrtc")][string]$Protocol,
  [int]$Runs = 1,
  [string]$Room = "",
  [int]$ScenarioDurationMs = 0,
  [int]$MaxWaitMs = 0,
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

if ($MaxWaitMs -le 0) { $MaxWaitMs = $ScenarioDurationMs + 60000 }
$canValidateResults = [bool]($ResultsDir -and (Test-Path (Split-Path -Parent $ResultsDir)))

if ($canValidateResults) {
  Write-Host "Eseguo $Runs run di '$ScenarioId' ($Protocol) contro $BaseUrl, room base '$Room' (ogni run termina con i 2 file di risultato, attesa massima $($MaxWaitMs)ms)`n"
} else {
  Write-Host "Eseguo $Runs run di '$ScenarioId' ($Protocol) contro $BaseUrl, room base '$Room' (cartella results/ non disponibile: attesa fissa di $($ScenarioDurationMs + $BufferMs)ms per run)`n"
}

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

  $newFiles = 0
  if ($canValidateResults) {
    # Attende i 2 file di risultato del run (A e B), controllando una volta al secondo.
    $deadline = (Get-Date).AddMilliseconds($MaxWaitMs)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 1000
      if (Test-Path $ResultsDir) {
        $resultsCountNow = (Get-ChildItem $ResultsDir -Filter "$runId-*.json" -ErrorAction SilentlyContinue | Measure-Object).Count
        $newFiles = $resultsCountNow - $resultsCountBefore
        if ($newFiles -ge 2) { break }
      }
    }
    # Lascia visibile per un momento la schermata finale prima di chiudere le finestre.
    Start-Sleep -Milliseconds 1500
  } else {
    Start-Sleep -Milliseconds ($ScenarioDurationMs + $BufferMs)
  }

  foreach ($proc in @($procA, $procB)) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { }
  }
  # Chrome lancia processi figli: ripulisco anche eventuali rimasti con lo stesso user-data-dir.
  Get-Process chrome -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $ChromePath -and ($_.CommandLine -match [regex]::Escape($profileA) -or $_.CommandLine -match [regex]::Escape($profileB)) } |
    ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { } }

  Remove-Item -Recurse -Force $profileA, $profileB -ErrorAction SilentlyContinue

  if ($canValidateResults -and (Test-Path $ResultsDir)) {
    $resultsCountAfter = (Get-ChildItem $ResultsDir -Filter "$runId-*.json" -ErrorAction SilentlyContinue | Measure-Object).Count
    $newFiles = $resultsCountAfter - $resultsCountBefore
    if ($newFiles -lt 2) {
      Write-Warning "Run ${i}: attesi 2 file di risultato (A+B) con prefisso '$runId-', trovati $newFiles entro $($MaxWaitMs)ms. Controllare manualmente (connessione fallita? partita non conclusa?)."
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
