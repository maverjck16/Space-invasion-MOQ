# Testbed deterministico — versione MoQ

Questo progetto e' una copia di [`SPACE-INVASION-MOQ-COMPLETO/moq-keycast-ts`](../SPACE-INVASION-MOQ-COMPLETO/moq-keycast-ts), estesa con un sistema di esperimenti automatici, deterministici e ripetibili, per confrontare in modo scientificamente corretto le prestazioni di rete con la [controparte WebRTC](../Space-invasion-WebRTC-Testbed/TESTBED.md). Il gioco originale (lobby manuale, controllo da tastiera) **funziona esattamente come prima** se aperto senza parametri speciali nell'URL: tutto quello che segue si attiva solo con `?auto=1`.

> Aggiornamento rispetto alla versione precedente di questo documento: il sistema e' passato da UNO scenario condiviso (stessa timeline per entrambi i client) a **3 scenari**, ciascuno con **due timeline di input distinte** (Player A / Player B, comportamenti diversi), un **controllo automatico di determinismo PASS/FAIL** a fine partita, e un **simulatore headless** (`scripts/headless-sim.mjs`) che calcola i risultati attesi eseguendo il vero motore di gioco fuori dal browser. Vedi la cronologia del cambiamento in fondo.

## Regole della partita automatica 1v1 (aggiornamento)

Con `?auto=1` la partita segue regole diverse da quella manuale, che resta invariata (timer di 3 minuti, 3 vite con respawn):

- **una sola vita** per giocatore, nessun respawn e **nessun timer**: il run finisce quando la partita ha un esito, non dopo `durationMs` (che ora indica solo la lunghezza massima della timeline di input);
- chi viene eliminato resta fuori gioco (sul suo schermo compare "SEI STATO ELIMINATO") e l'avversario **continua a giocare**;
- se vengono eliminati **entrambi** la partita finisce subito: **GAME OVER** a chi e' stato eliminato per primo (anche se ha piu' punti), **YOU WIN** all'altro;
- **3 s dopo l'eliminazione dell'ultima ondata** la partita finisce: se e' sopravvissuto uno solo vince lui, se sono sopravvissuti entrambi vince chi ha piu' punti;
- a parita' compare **DRAW** in argento.

Le ondate scriptate sono ora tre: la 4x7 che non spara, poi una riga di 10 alieni che spara e, dopo la sua eliminazione completa, una seconda riga uguale (in entrambi gli scenari; in `scenario-2` ogni ondata porta anche il suo asteroide).

Come resta coerente l'esito tra i due client (vedi `LocalGameEngine.updateTestbedMatchState()` e `updateTestbedWaves()`):

- i due motori partono insieme quando i client si vedono nella room, e i tempi di gioco si misurano in frame;
- il frame di eliminazione del giocatore e quello di eliminazione di ogni ondata viaggiano negli snapshot (`eliminatedAtFrame`, `wavesClearedAtFrame`) e vengono ripetuti finche' la partita non finisce; a fine partita ogni client invia `gameActive: false` come stato definitivo;
- ogni ondata compare nello stesso frame su entrambi i client (pausa di 1 s dopo l'eliminazione della precedente e `minStartFrame` calcolato dal generatore);
- nel testbed gli effetti grafici e la scelta dell'invasore che spara usano generatori casuali separati, e le eliminazioni vengono ripetute per qualche snapshot.

Le timeline di `scenario-1`/`scenario-2` sono registrate da `scripts/generate-scenario.mjs` facendo giocare due bot (mirano, schivano, sparano) sul motore reale, e `ScenarioPlayer` le esegue **a frame** (campo `frame` di ogni azione) invece che con i timer del browser. Esiti attuali: in `scenario-1` sopravvivono entrambi e A vince a punti; in `scenario-2` B non schiva l'asteroide della prima riga che spara, viene eliminato e A vince da unico sopravvissuto, pur avendo meno punti.

`scripts/headless-sim.mjs` simula ora i due client insieme (opzione `--latency-ms`) e `scripts/verify-determinism.mjs` controlla riproducibilita', coerenza tra A e B e stabilita' dell'esito con diverse latenze (`--latencies`). Il punteggio ha una tolleranza (`scoreTolerance`), perche' un invasore colpito da entrambi mentre l'eliminazione e' ancora in viaggio vale punti a tutti e due. `scripts/run-batch.ps1` non aspetta piu' un tempo fisso: chiude ogni run quando compaiono i due file di risultato (attesa massima `-MaxWaitMs`).

Le sezioni seguenti descrivono la versione precedente del testbed e restano valide per architettura, determinismo e metriche; tabelle degli scenari e risultati attesi aggiornati sono nei file `scenario-N.json`.

## Architettura

```
scenario-N.json (seed, durata, room, gameConfig, azioni A/B, expected)
        |
        v
src/testbed/scenarioPlayer.ts  (dispatcha KeyboardEvent in base al timeMs, non ai frame)
        |
        v
src/game/localGame/LocalGameEngine.ts  (motore di gioco, IDENTICO byte-per-byte al testbed WebRTC
        |                                tranne l'import del tipo GameSnapshot)
        v
src/moq/publisher.ts + subscriber.ts  (unico punto che cambia per protocollo)
```

`LocalGameEngine` non sa nulla di scenari/RNG/MoQ: riceve solo eventi tastiera (veri o scriptati, indistinguibili) e una callback `onSnapshot`. Il layer di trasporto (`src/moq/`) impacchetta/invia quello stesso `GameSnapshot` senza mai leggere lo stato di gioco. Questo e' quanto richiesto dalla tesi ("Scenario → ScenarioPlayer → Game/Input → Transport"): l'unica cosa che cambia davvero tra i due testbed e' il transport layer.

## I 3 scenari

| Scenario | Room | Durata | Caratteristiche | gameConfig |
|---|---|---|---|---|
| `scenario-1` | `room-test-1` | 45 s | Baseline, carico leggero, deve completarsi in modo robusto | griglie rare (2-3 invasori, 1 riga), asteroidi molto rari |
| `scenario-2` | `room-test-2` | 35 s | Medium load, piu' nemici/spari, piu' traffico | griglie frequenti (3-4x1-2), asteroidi piu' frequenti |
| `scenario-3` | `room-test-3` | 60 s | Stress/long, asteroidi **disattivati**, 4 periodi di attivita' diversa nel tempo (0-15s moderata, 15-30s alta, 30-45s bassa, 45-60s molto alta) | griglie molto frequenti, `asteroidsEnabled:false` |

In tutti e 3 gli scenari **Player A e Player B condividono lo stesso seed** (quindi lo stesso "mondo": stessi spawn di griglie/asteroidi, essendo ciascun client autoritativo solo sulla propria simulazione locale - architettura P2P, vedi README) ma hanno **timeline di input diverse** (direzione di partenza, cadenza di sparo, traiettoria) — per costruzione ottengono quindi punteggi ed esiti diversi, entrambi deterministici. Risultati attesi attuali (calcolati con il simulatore headless, vedi sotto):

| Scenario | Player A | Player B |
|---|---|---|
| `scenario-1` | score 100, sopravvive | score 0, sopravvive |
| `scenario-2` | score 600, sopravvive | score 300, muore |
| `scenario-3` | score 300, muore | score 300, muore |

Questi numeri sono quelli scritti nel campo `expected` di ciascun `scenario-N.json` (in `TS/frontend/public/scenarios/`) e sono quelli con cui il gioco reale (nel browser) si confronta a fine partita per decidere PASS/FAIL.

## Il file scenario (schema)

Vedi `src/testbed/scenario.types.ts` per i tipi TypeScript completi. In sintesi, `scenario-N.json` contiene: `scenarioId`, `seed`, `durationMs`, `room` (suggerita, sovrascrivibile via query string), `durationToleranceMs`, `gameConfig` (intervalli di spawn griglie/asteroidi, dimensione griglie, asteroidi on/off), `players.A.actions` / `players.B.actions` (liste di `{id, timeMs, type, dir?}`, eseguite in base al **tempo simulato/timestamp**, non al conteggio dei frame — vedi `scenarioPlayer.ts`), e `expected.A` / `expected.B` (risultato di riferimento: `finalScore`, `survived`, `finalPositionX/Y`, `actualDurationMs`).

## Come funziona il determinismo

**Casualita'**: unica fonte e' `Math.random()` (verificato con `grep -rn "Math.random" src/`), usata in `LocalGameEngine.ts`, `entities/Grid.ts`, `entities/Asteroid.ts`. `installDeterministicRandom(seed)` sovrascrive `Math.random` globale **prima** di costruire qualunque `LocalGameEngine`.

**Input**: ogni azione ha un `timeMs` assoluto; `ScenarioPlayer` la esegue con `window.setTimeout(..., action.timeMs)` (tempo simulato/reale, non frame) dispatchando veri `KeyboardEvent` — il motore di gioco non distingue input scriptato da input umano.

**Limite onesto**: la sequenza *logica* di eventi (stessi spawn, stesse scelte, stessi input, nello stesso ordine) e' garantita identica run dopo run. Il timestamp esatto al millisecondo di ciascun evento nel BROWSER puo' variare leggermente (jitter di `setTimeout`/`requestAnimationFrame`) — per questo `durationToleranceMs` nello scenario da' un margine al controllo di determinismo sulla durata effettiva, mentre punteggio/sopravvivenza/posizione finale sono confrontati **senza tolleranza** (dipendono solo da seed+azioni, mai dal timing preciso del browser).

**Controllo automatico PASS/FAIL**: a fine scenario, `main.ts` legge l'ultimo `GameSnapshot` locale disponibile (score, gameOver, posizione) e lo confronta con `expected[player]` dello scenario (vedi `src/testbed/determinism.ts`). L'esito (`determinismCheck: {status: "PASS"|"FAIL"|"UNKNOWN", checks: [...]}`) viene stampato in console e incluso nel report salvato in `results/`. Esempio di lettura:

```
scenarioId: scenario-1, player: A
finalScore: expected 100, actual 100      -> PASS
survived: expected true, actual true      -> PASS
actualDurationMs: expected 45000 (+-500), actual 45016.7 -> PASS
=> determinismCheck.status = "PASS"
```

Un `FAIL` qui significa che il **gameplay locale** ha divergito dall'atteso (bug di determinismo, scenario modificato senza rigenerare gli `expected`, ecc.) — **non** ha nulla a che fare con le prestazioni di rete, che sono misurate separatamente (vedi sotto). E' esattamente questa separazione che permette di dire "le differenze osservate tra MoQ e WebRTC sono dovute al trasporto" con fondamento.

## Il simulatore headless (`scripts/headless-sim.mjs`)

Calcola i risultati attesi **eseguendo il vero codice** di `src/game/localGame/` e `src/testbed/scenarioPlayer.ts` (bundlizzato con esbuild, gia' una dipendenza di Vite — nessuna dipendenza nuova installata) dentro Node, con:
- stub minimi di DOM/canvas/`Image` (le dimensioni reali degli sprite sono lette dai PNG veri via un parser dell'header IHDR, non hardcoded);
- un **orologio virtuale** (frame fissi da 1000/60 ms) al posto di `requestAnimationFrame`/`setTimeout` reali, cosi' il risultato e' riproducibile al 100% (elimina il jitter del browser reale, vedi limite sopra).

```powershell
node scripts/headless-sim.mjs --scenario "TS/frontend/public/scenarios/scenario-1.json" --player A --repeat 5
```

`scripts/verify-determinism.mjs` esegue il simulatore per tutti gli scenari x entrambi i player, verifica che N ripetizioni indipendenti diano lo stesso risultato bit-per-bit, e (con `--write`) scrive il campo `expected` nei file scenario:

```powershell
node scripts/generate-scenario.mjs          # rigenera scenario-1/2/3.json (azioni + gameConfig)
node scripts/verify-determinism.mjs --write --repeat 5   # calcola/scrive "expected", verifica riproducibilita'
```

**Nota metodologica**: questo simulatore sostituisce un tool precedente, usato in una fase precedente del progetto ma mai incluso nel repository (quindi non verificabile da chi clonava il progetto). Questo e' invece versionato, documentato, e byte-per-byte identico tra i due testbed — chiunque puo' rieseguirlo e ottenere lo stesso risultato.

## Sincronizzazione Player A / Player B (avvio scenario)

I due client automatici NON iniziano lo scenario a tempi arbitrari: dopo essersi connessi, ciascuno attende (tramite le notifiche di presenza gia' esistenti nel subscriber) che il **peer remoto sia visibile nella room** prima di avviare `ScenarioPlayer` — vedi `waitForPeerReady()` in `main.ts`. Se il peer non arriva entro 15s (debug con un solo client aperto) lo scenario parte comunque, con un log esplicito. Meccanismo volutamente semplice: nessun handshake/protocollo nuovo, solo un'attesa su un segnale gia' disponibile.

## Come avviare un test

**Richiede l'infrastruttura MoQ gia' funzionante** (relay + dominio pubblico + certificati — vedi `README.md`): `vite.config.ts`/`config.ts` puntano al certificato TLS reale di `spaceinvasion.ddns.net` e al relay pubblico, quindi **non puo' girare in locale su questa macchina** (limite di infrastruttura, non di codice — vedi FASE 10/sezione "Test eseguiti" nel report).

### Scenario 1 (baseline)
```
Server: docker compose up --build   (sulla VM)
Client A: https://spaceinvasion.ddns.net/?auto=1&scenario=scenario-1&player=A&room=room-test-1
Client B: https://spaceinvasion.ddns.net/?auto=1&scenario=scenario-1&player=B&room=room-test-1
```

### Scenario 2 (medium load)
```
Client A: https://spaceinvasion.ddns.net/?auto=1&scenario=scenario-2&player=A&room=room-test-2
Client B: https://spaceinvasion.ddns.net/?auto=1&scenario=scenario-2&player=B&room=room-test-2
```

### Scenario 3 (stress/long)
```
Client A: https://spaceinvasion.ddns.net/?auto=1&scenario=scenario-3&player=A&room=room-test-3
Client B: https://spaceinvasion.ddns.net/?auto=1&scenario=scenario-3&player=B&room=room-test-3
```

`username` e' opzionale (default "Fra" per A, "Luca" per B); `runId` e' opzionale (default `<scenario>-<player>-<timestamp>`).

## Piu' run in sequenza (batch)

```powershell
.\scripts\run-batch.ps1 -BaseUrl "https://spaceinvasion.ddns.net" -ScenarioId scenario-1 -Protocol moq -Runs 20
```

Lo script legge in locale `scenario-1.json` per ricavare room/durata di default, apre N coppie di finestre Chrome (Player A + Player B, profili isolati), attende la durata dello scenario + un margine, e **verifica che siano comparsi 2 nuovi file di risultato** in `results/` per ogni run (non si limita piu' ad aprire/chiudere le finestre alla cieca come nella versione precedente dello script) — segnala con un warning i run per cui i file attesi non sono comparsi.

## Dove sono i risultati e come leggerli

`TS/frontend/results/<runId>-<timestamp>.json`, uno per client per run. Struttura (vedi `src/testbed/runLogger.ts`):

```json
{
  "runId": "moq-scenario-1-r1-A",
  "protocol": "moq",
  "scenarioId": "scenario-1",
  "scenarioSeed": 250,
  "scenarioDurationMs": 45000,
  "player": "A",
  "username": "Fra",
  "room": "room-test-1",
  "startedAt": "...", "finishedAt": "...",
  "metricsSummary": { /* rete: RTT, jitter, banda, gap, ... - vedi src/metrics/metrics.ts */ },
  "gameResults": { "finalScore": 100, "survived": true, "finalPositionX": 481, "finalPositionY": 535.5, "actualDurationMs": 45016.7 },
  "determinismCheck": { "status": "PASS", "checks": [ ... ] },
  "inputLog": [ ... ],
  "errors": []
}
```

**Per sapere se un run e' valido**: apri il JSON e controlla `determinismCheck.status`. `"PASS"` = il gameplay locale ha prodotto esattamente il risultato atteso, quindi le metriche di rete in quello stesso file sono attribuibili con fiducia al trasporto MoQ. `"FAIL"` = qualcosa nel gameplay e' andato diversamente dall'atteso (da investigare prima di usare quel run per il confronto). `"UNKNOWN"` = lo scenario non ha un `expected` per quel player (es. scenario modificato a mano senza rigenerare).

## Metriche raccolte

**Di rete** (`metricsSummary`, identiche per struttura al testbed WebRTC — vedi la sezione "Equivalenza" del report finale per cosa e' davvero confrontabile 1:1 e cosa no): RTT (round-trip reale via eco applicativo, non simulato), stima di latenza one-way (RTT/2), jitter, banda upload/download, byte inviati/ricevuti, frequenza di aggiornamento (msg/s), gap e duplicati/fuori-ordine (dedotti dal numero di sequenza applicativo).

**Applicative/di scenario** (`gameResults`, nuove rispetto alla versione precedente di questo documento): punteggio finale, sopravvivenza, posizione finale, durata effettiva dello scenario.

**Non raccolte / non separabili con precisione**: kill di invasori e asteroidi distrutti separatamente (lo `score` li somma con pesi diversi — 100 per invasore, 70×maxHealth per asteroide — ma il motore di gioco non espone un contatore dedicato; vedi "Cosa rimane da fare" nel report finale) e statistiche native del transport QUIC (retransmission, congestion window) — le metriche di rete sono tutte calcolate a livello applicativo osservando i messaggi, non da API interne di WebTransport.

## Cosa e' stato verificato e cosa no (limiti di infrastruttura)

Vedi la sezione "Test eseguiti" del report di consegna per il dettaglio completo PASS/FAIL/NON ESEGUIBILE. In sintesi: typecheck, build, generazione scenari, simulazione headless e verifica di determinismo (bit-per-bit, ripetuta) sono stati eseguiti realmente su questa macchina. **Un run end-to-end reale contro il relay MoQ pubblico NON e' stato eseguibile** (richiede la VM `spaceinvasion.ddns.net`, non raggiungibile da questo ambiente) — va verificato appena l'infrastruttura e' disponibile, seguendo i comandi sopra.

**Nota importante sull'ambiente di test browser automatizzato**: un run end-to-end reale a due tab e' stato pero' eseguito con successo sul testbed **WebRTC** (che gira in locale, senza bisogno del relay) usando un browser controllato via automazione (Claude Browser tool). Connessione, sincronizzazione Player A/B, raccolta metriche di rete reali (RTT/banda/jitter) e salvataggio del report sono risultati **tutti funzionanti**. Il `determinismCheck` di quel run pero' e' risultato `FAIL`: indagando con diagnostica mirata (intercettando `CanvasRenderingContext2D.drawImage`) e' emerso che in quell'ambiente di automazione **`requestAnimationFrame` non viene mai invocato** (0 chiamate osservate su piu' secondi), quindi il ciclo di gioco (`animate()`, che aggiorna posizione/punteggio/collisioni) resta di fatto congelato, mentre tutto cio' che NON dipende da rAF (rete, `setInterval`, sincronizzazione, salvataggio del report) continua a funzionare regolarmente — e' esattamente lo stesso limite gia' segnalato in una fase precedente di questo progetto per l'ambiente di test WebRTC (vedi la cronologia in fondo). Non e' quindi un difetto del codice del testbed, ma un limite noto degli ambienti di browser automation: un utente che apre due finestre Chrome normali (con almeno una a fuoco) non dovrebbe incontrarlo. Per questo motivo il riferimento affidabile per il determinismo del gameplay resta il simulatore headless (`scripts/headless-sim.mjs`), che non dipende da `requestAnimationFrame` reale.
