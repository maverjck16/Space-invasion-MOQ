# Testbed deterministico — versione WebRTC

Questo progetto e' una copia di [`Space-invasion-WebRTC-provaF`](../Space-invasion-WebRTC-provaF), estesa con un sistema di esperimenti automatici, deterministici e ripetibili, per confrontare in modo scientificamente corretto le prestazioni di rete con la [controparte MoQ](../Space-invasion-MOQ-Testbed/TESTBED.md). Il gioco originale (lobby manuale, controllo da tastiera) **funziona esattamente come prima** se aperto senza parametri speciali nell'URL: tutto quello che segue si attiva solo con `?auto=1`.

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
src/game/localGame/LocalGameEngine.ts  (motore di gioco, IDENTICO byte-per-byte al testbed MoQ
        |                                tranne l'import del tipo GameSnapshot)
        v
src/webrtc/publisher.ts + subscriber.ts + peerManager.ts  (unico punto che cambia per protocollo)
```

`LocalGameEngine` non sa nulla di scenari/RNG/WebRTC: riceve solo eventi tastiera (veri o scriptati, indistinguibili) e una callback `onSnapshot`. Il layer di trasporto (`src/webrtc/`) impacchetta/invia quello stesso `GameSnapshot` senza mai leggere lo stato di gioco. Questo e' quanto richiesto dalla tesi ("Scenario → ScenarioPlayer → Game/Input → Transport"): l'unica cosa che cambia davvero tra i due testbed e' il transport layer.

## I 3 scenari

| Scenario | Room | Durata | Caratteristiche | gameConfig |
|---|---|---|---|---|
| `scenario-1` | `room-test-1` | 45 s | Baseline, carico leggero, deve completarsi in modo robusto | griglie rare (2-3 invasori, 1 riga), asteroidi molto rari |
| `scenario-2` | `room-test-2` | 35 s | Medium load, piu' nemici/spari, piu' traffico | griglie frequenti (3-4x1-2), asteroidi piu' frequenti |
| `scenario-3` | `room-test-3` | 60 s | Stress/long, asteroidi **disattivati**, 4 periodi di attivita' diversa nel tempo (0-15s moderata, 15-30s alta, 30-45s bassa, 45-60s molto alta) | griglie molto frequenti, `asteroidsEnabled:false` |

In tutti e 3 gli scenari **Player A e Player B condividono lo stesso seed** (quindi lo stesso "mondo": stessi spawn di griglie/asteroidi, essendo ciascun client autoritativo solo sulla propria simulazione locale - architettura P2P mesh, vedi README) ma hanno **timeline di input diverse** (direzione di partenza, cadenza di sparo, traiettoria) — per costruzione ottengono quindi punteggi ed esiti diversi, entrambi deterministici. Risultati attesi attuali (calcolati con il simulatore headless, vedi sotto — **identici bit-per-bit** a quelli del testbed MoQ, verificato eseguendo il simulatore separatamente su entrambi i progetti):

| Scenario | Player A | Player B |
|---|---|---|
| `scenario-1` | score 100, sopravvive | score 0, sopravvive |
| `scenario-2` | score 600, sopravvive | score 300, muore |
| `scenario-3` | score 300, muore | score 300, muore |

Questi numeri sono quelli scritti nel campo `expected` di ciascun `scenario-N.json` (in `frontend/public/scenarios/`) e sono quelli con cui il gioco reale (nel browser) si confronta a fine partita per decidere PASS/FAIL.

## Il file scenario (schema)

Vedi `frontend/src/testbed/scenario.types.ts` per i tipi TypeScript completi — **identico byte-per-byte** al testbed MoQ. In sintesi, `scenario-N.json` contiene: `scenarioId`, `seed`, `durationMs`, `room` (suggerita, sovrascrivibile via query string), `durationToleranceMs`, `gameConfig` (intervalli di spawn griglie/asteroidi, dimensione griglie, asteroidi on/off), `players.A.actions` / `players.B.actions` (liste di `{id, timeMs, type, dir?}`, eseguite in base al **tempo simulato/timestamp**, non al conteggio dei frame — vedi `scenarioPlayer.ts`), e `expected.A` / `expected.B` (risultato di riferimento: `finalScore`, `survived`, `finalPositionX/Y`, `actualDurationMs`).

## Come funziona il determinismo

Identico al testbed MoQ (stesso motore di gioco, stesso `game/localGame/`, byte-per-byte): unica fonte di casualita' e' `Math.random()`, sovrascritta globalmente da `installDeterministicRandom(seed)` prima di costruire qualunque `LocalGameEngine`; input scriptati via veri `KeyboardEvent`, eseguiti in base al `timeMs` (non ai frame). Vedi [`../Space-invasion-MOQ-Testbed/TESTBED.md`](../Space-invasion-MOQ-Testbed/TESTBED.md) per i dettagli completi — non ripetuti qui per evitare che le due descrizioni divergano nel tempo.

**Controllo automatico PASS/FAIL**: a fine scenario, `main.ts` legge l'ultimo `GameSnapshot` locale disponibile (score, gameOver, posizione) e lo confronta con `expected[player]` dello scenario (vedi `src/testbed/determinism.ts`). L'esito (`determinismCheck: {status: "PASS"|"FAIL"|"UNKNOWN", checks: [...]}`) viene stampato in console e incluso nel report salvato in `results/`.

## Il simulatore headless (`scripts/headless-sim.mjs`)

Identico byte-per-byte allo script del testbed MoQ (vedi la sua documentazione per i dettagli tecnici): bundlizza (esbuild, gia' dipendenza di Vite) ed esegue il **vero** codice di `src/game/localGame/` fuori dal browser, con un orologio virtuale al posto di `requestAnimationFrame`/`setTimeout` reali.

```bash
node scripts/generate-scenario.mjs          # rigenera scenario-1/2/3.json (azioni + gameConfig)
node scripts/verify-determinism.mjs --write --repeat 5   # calcola/scrive "expected", verifica riproducibilita'
```

## Sincronizzazione Player A / Player B (avvio scenario)

Identico al testbed MoQ: dopo la connessione, ciascun client attende (tramite le notifiche di presenza gia' esistenti nel subscriber WebRTC) che il **peer remoto sia visibile nella room** prima di avviare `ScenarioPlayer` — vedi `waitForPeerReady()` in `main.ts`. Timeout di sicurezza a 15s se il peer non arriva mai.

## Come avviare un test

A differenza della versione MoQ, questo testbed **gira interamente in locale**, senza certificati/dominio:

```bash
cd Space-invasion-WebRTC-Testbed
npm run install:all   # solo la prima volta (installa anche in signaling/ e frontend/)
```

I due processi (signaling WebSocket sulla porta 8080, Vite sulla porta 5173) vanno avviati separatamente (lo script `npm run dev` alla radice richiede il pacchetto `concurrently`, non installato nella root - se manca: `npm install --prefix . concurrently`, oppure piu' semplicemente due terminali):
```bash
npm run dev:signaling   # terminale 1
npm run dev:frontend    # terminale 2
```

### Scenario 1 (baseline)
```
Client A: http://localhost:5173/?auto=1&scenario=scenario-1&player=A&room=room-test-1
Client B: http://localhost:5173/?auto=1&scenario=scenario-1&player=B&room=room-test-1
```

### Scenario 2 (medium load)
```
Client A: http://localhost:5173/?auto=1&scenario=scenario-2&player=A&room=room-test-2
Client B: http://localhost:5173/?auto=1&scenario=scenario-2&player=B&room=room-test-2
```

### Scenario 3 (stress/long)
```
Client A: http://localhost:5173/?auto=1&scenario=scenario-3&player=A&room=room-test-3
Client B: http://localhost:5173/?auto=1&scenario=scenario-3&player=B&room=room-test-3
```

`username` e' opzionale (default "Fra" per A, "Luca" per B); `runId` e' opzionale (default `<scenario>-<player>-<timestamp>`).

## Piu' run in sequenza (batch)

```powershell
.\scripts\run-batch.ps1 -BaseUrl "http://localhost:5173" -ScenarioId scenario-1 -Protocol webrtc -Runs 20
```

Richiede Chrome installato e `npm run dev:signaling` + `npm run dev:frontend` gia' avviati in altri terminali. Lo script legge in locale `scenario-1.json` per ricavare room/durata di default, apre N coppie di finestre Chrome (Player A + Player B, profili isolati), attende la durata dello scenario + un margine, e **verifica che siano comparsi 2 nuovi file di risultato** in `results/` per ogni run.

## Dove sono i risultati e come leggerli

`frontend/results/<runId>-<timestamp>.json` — stessa struttura del testbed MoQ (vedi il suo `TESTBED.md` per lo schema completo e come leggere `determinismCheck.status`), con l'aggiunta di `metricsSummary.peerConnectMs` (tempo di apertura del DataChannel, metrica specifica WebRTC senza equivalente diretto in MoQ - vedi la sezione "Equivalenza" del report finale).

## Metriche raccolte

Vedi [`../Space-invasion-MOQ-Testbed/TESTBED.md`](../Space-invasion-MOQ-Testbed/TESTBED.md) (identiche per struttura, non ripetute qui). Unica aggiunta specifica WebRTC: `peerConnectMs` (tempo di negoziazione ICE/DTLS + apertura DataChannel per peer).

## Cosa e' stato verificato dal vivo in questa fase (e cosa no)

**Verificato con un run end-to-end reale** (due tab in un browser controllato via automazione, non semplice ispezione del codice): avvio dei due server locali (`signaling` + `vite`), connessione WebRTC riuscita tra i due client (`[Metrics] canale dati con ... aperto in ~215ms`), **sincronizzazione Player A/B funzionante** (entrambi rilevano la presenza del peer e avviano lo scenario quasi simultaneamente), metriche di rete **reali e non nulle** durante tutto il run (RTT 14-60ms, ~25 messaggi/s per lato, banda coerente), completamento dello scenario dopo 45s, salvataggio del report in `results/` con `gameResults`/`determinismCheck` popolati.

**NON verificabile in questo specifico ambiente di test**: il `determinismCheck` di quel run e' risultato `FAIL` (score/posizione finale = valori di spawn, mai aggiornati). Indagando con diagnostica mirata (intercettando `CanvasRenderingContext2D.drawImage` e testando `requestAnimationFrame` direttamente) e' emerso che **nell'ambiente di browser automation usato per questo test `requestAnimationFrame` non viene mai invocato** (0 chiamate osservate su piu' secondi) — quindi `animate()` (il ciclo che aggiorna posizione/punteggio/collisioni) resta di fatto congelato, mentre tutto cio' che non dipende da rAF (rete, `setInterval`, sincronizzazione, salvataggio) funziona regolarmente. Questo e' esattamente lo stesso limite gia' segnalato in una fase precedente di questo progetto (vedi sotto, "Cosa avevo verificato in precedenza") per il medesimo tipo di ambiente automatizzato — non e' un difetto del testbed, ma una caratteristica nota dei browser controllati via automazione/CDP quando la tab non ha "vero" focus grafico. Un utente che apre due finestre Chrome normali non dovrebbe incontrare questo limite. **Per questo motivo il riferimento affidabile per il determinismo del gameplay resta il simulatore headless** (`scripts/headless-sim.mjs`), verificato bit-per-bit riproducibile su 5 ripetizioni per ciascuno dei 6 casi (3 scenari x 2 player), sia in questo progetto sia nel testbed MoQ, con risultati identici tra i due.

## Cosa avevo verificato in precedenza (cronologia, fase precedente del progetto)

Il mio ambiente di test browser aveva un limite gia' noto: `requestAnimationFrame` non scattava mai (0 chiamate anche dopo secondi di attesa), quindi non si poteva osservare l'esito di una vera partita da 45s solo aprendo due tab. Per verificare comunque **davvero** (non solo per ispezione del codice) che uno scenario facesse sopravvivere il giocatore, era stato scritto un simulatore headless ad-hoc (non incluso nel repository di allora): il bundle di `game/localGame/` compilato con esbuild ed eseguito in Node con stub minimi e un orologio virtuale accelerato. Quel lavoro e' stato **rifatto da zero in questa fase** come `scripts/headless-sim.mjs`, questa volta **versionato, documentato e byte-per-byte identico tra i due testbed**, cosi' chiunque puo' rieseguirlo e ottenere lo stesso risultato — a differenza dello strumento precedente, che non era incluso nel repository e quindi non verificabile da chi clonava il progetto.
