"use strict";

// Simulazione autoritativa dell'arena condivisa (griglie di invasori, asteroidi, proiettili
// nemici) per UNA partita 1v1. Nessuna dipendenza dal DOM/canvas/WebSocket: questo modulo e'
// puro (riceve input, avanza lo stato di un frame, restituisce cio' che serve trasmettere) cosi'
// puo' essere usato sia da server.js (che lo fa girare in un vero processo Node e lo espone via
// WebSocket ai due client) sia dagli script offline di verifica (headless-sim.mjs,
// verify-determinism.mjs), senza bisogno di bundlizzare nulla con esbuild ne' di un DOM stub.
//
// PERCHE' QUESTO FILE ESISTE (vedi anche i commenti in game/localGame/LocalGameEngine.ts, che
// prima di questa modifica conteneva la stessa logica ma duplicata identica su ENTRAMBI i client,
// tenuta sincronizzata solo installando lo stesso seed pseudo-casuale su entrambi - vedi
// testbed/rng.ts, ora rimosso dal lato client per la partita reale). Un'architettura del genere
// (spesso chiamata "lockstep deterministico") e' un pattern legittimo in altri generi di gioco, ma
// qui non regge per due motivi verificati sul codice precedente: (1) presuppone che le due copie
// eseguano ESATTAMENTE le stesse operazioni nello stesso ordine per restare identiche, ma un
// asteroide mirava alla navicella LOCALE di ciascun client, quindi la stessa entita' condivisa
// finiva su traiettorie diverse sui due lati (vedi la funzione spawnAsteroid() piu' sotto per come
// e' stato risolto: un solo bersaglio, deciso qui); (2) anche se fosse stato perfettamente
// deterministico, un client che conosce il seed potrebbe calcolare in anticipo l'intera partita
// (lo stesso problema per cui un seed noto in Tetris renderebbe la partita vincibile a tavolino).
// Da qui in poi lo stato dell'arena condivisa esiste in un solo posto (questo modulo, eseguito
// SOLO nel processo server): i client si limitano a inviare il proprio input (posizione della
// propria navicella, colpi sparati) e a renderizzare quello che ricevono, esattamente come in un
// gioco multiplayer con un world server "vero" (es. agar.io: i nemici/il cibo vivono sul server,
// il client li osserva soltanto).
//
// Il generatore pseudo-casuale (mulberry32, identico all'algoritmo gia' usato prima) resta invece
// legittimo qui: non serve piu' a far combaciare due copie indipendenti (il problema originale),
// ma solo a rendere ripetibile, se lo si desidera, la sequenza di spawn di QUESTA UNICA
// simulazione autoritativa - utile per gli scenari di test del testbed (stesso seed => stessa
// partita ad ogni esecuzione, per verificare che la logica del server sia deterministica in se
// stessa), inutile e quindi non usato per una partita manuale reale (seed casuale ad ogni match).

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;
const FRAME_MS = 1000 / 60;

const MATCH_DURATION_MS = 3 * 60 * 1000;
const LIVES_PER_PLAYER = 3;
const TESTBED_LIVES_PER_PLAYER = 1;
const RESPAWN_DELAY_MS = 2000;
const RESPAWN_INVULNERABILITY_MS = 2000;
const TESTBED_END_DELAY_AFTER_LAST_WAVE_MS = 3000;
const TESTBED_WAVE_SPAWN_DELAY_MS = 1000;
const TESTBED_END_DELAY_FRAMES = Math.round(TESTBED_END_DELAY_AFTER_LAST_WAVE_MS / FRAME_MS);
const TESTBED_WAVE_SPAWN_DELAY_FRAMES = Math.round(TESTBED_WAVE_SPAWN_DELAY_MS / FRAME_MS);

// Dimensioni reali degli sprite (misurate sui PNG in frontend/src/image/, non inventate): invader
// scala 1:1 sul proprio PNG, spaceship scala 0.18 - vedi entities/Invader.ts e entities/Player.ts
// nel client per il codice originale che le calcolava a runtime dall'immagine caricata.
const INVADER_WIDTH = 31;
const INVADER_HEIGHT = 39;
// Default prima che il client mandi il primo messaggio "state" con le proprie dimensioni reali
// (Player.ts parte da 60x60 finche' l'immagine non e' caricata) - sovrascritto quasi subito.
const PLAYER_DEFAULT_WIDTH = 60;
const PLAYER_DEFAULT_HEIGHT = 60;

const DEFAULT_GAME_CONFIG = {
  gridSpawnIntervalFramesMin: 180,
  gridSpawnIntervalFramesMax: 300,
  gridColumnsMin: 4,
  gridColumnsMax: 7,
  gridRowsMin: 2,
  gridRowsMax: 4,
  asteroidSpawnIntervalFramesMin: 90,
  asteroidSpawnIntervalFramesMax: 180,
  asteroidsEnabled: true,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIntervalIn(rng, min, max) {
  return Math.floor(rng() * (max - min + 1) + min);
}

function outcomeByScore(a, b) {
  if (a > b) return "win";
  if (a < b) return "lose";
  return "draw";
}

function hypot(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------------------------
// Una stanza = una partita 1v1. "matchMode" e "gameConfig" hanno lo stesso significato di prima
// (vedi game/localGame/types.ts: GameDifficultyConfig/ScriptedWave/ScriptedAsteroidEvent), qui
// duplicati come semplici oggetti JS invece che tipi TS (questo modulo non ha una build TS: gira
// direttamente in Node, come il server di signaling esistente).
// ---------------------------------------------------------------------------------------------
function createRoom({
  matchMode = "timed",
  gameConfig = null,
  seed = null,
  // Orologio iniettabile: di default quello reale (server.js in produzione), sostituibile con un
  // orologio virtuale dagli script offline (headless-sim.mjs/verify-determinism.mjs) cosi' i tempi
  // di invulnerabilita'/respawn e la durata della partita "timed" restano riproducibili bit per
  // bit invece di dipendere dall'orario di sistema di quando il test viene lanciato - stesso
  // principio del virtual clock gia' usato da questo progetto per il vecchio harness.
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const rng = mulberry32(seed === null || seed === undefined ? (now() ^ (Math.random() * 0xffffffff)) >>> 0 : seed >>> 0);

  const config = gameConfig || DEFAULT_GAME_CONFIG;
  const livesPerPlayer = matchMode === "testbed" ? TESTBED_LIVES_PER_PLAYER : LIVES_PER_PLAYER;

  const state = {
    matchMode,
    config,
    started: false,
    startAtEpochMs: null,
    ended: false,
    result: null,

    players: new Map(), // username -> playerState (vedi createPlayerState)

    // Campo condiviso: unica copia, autoritativa.
    nextId: 1,
    grids: [], // { id, x, y, vx, vy, width, invaders: [{id,x,y,width,height}], canShoot }
    asteroids: [], // { id, x, y, vx, vy, radius, rotation, rotationSpeed, health, maxHealth }
    invaderProjectiles: [], // { id, x, y, vx, vy, width, height }

    frames: 0, // vedi comemento in LocalGameEngine originale: azzerato solo dallo spawn casuale di una griglia
    scriptedClock: 0, // non si azzera mai, usato per le ondate/asteroidi scriptati e la fine partita testbed
    randomInterval: randomIntervalIn(rng, config.gridSpawnIntervalFramesMin, config.gridSpawnIntervalFramesMax),
    asteroidSpawnInterval: randomIntervalIn(
      rng,
      config.asteroidSpawnIntervalFramesMin,
      config.asteroidSpawnIntervalFramesMax,
    ),
    asteroidsSpawned: 0,
    nextScriptedWaveIndex: 0,
    nextScriptedAsteroidIndex: 0,

    // TESTBED: per ogni ondata scriptata (indice = posizione in config.scriptedWaves), id della
    // griglia generata e frame in cui e' risultata eliminata (undefined finche' non succede).
    testbedWaveGridId: [],
    testbedWaveClearedAtFrame: [],
    testbedActive: true, // equivalente di GameFlags.active, ma condiviso (una sola copia, non una per client)
    testbedStoppedAtFrame: null,

    tick: 0,
  };

  function nextArenaId(prefix) {
    state.nextId += 1;
    return `${prefix}-${state.nextId}`;
  }

  function createPlayerState(username) {
    return {
      username,
      x: CANVAS_WIDTH * 0.35,
      y: CANVAS_HEIGHT - PLAYER_DEFAULT_HEIGHT - 30,
      width: PLAYER_DEFAULT_WIDTH,
      height: PLAYER_DEFAULT_HEIGHT,
      score: 0,
      lives: livesPerPlayer,
      eliminated: false,
      respawning: false,
      invulnerableUntilMs: 0,
      eliminatedAtFrame: null,
      pendingProjectiles: new Map(), // id -> { x, y, vx, vy, radius }
      hasState: false,
    };
  }

  function addPlayer(username) {
    if (!state.players.has(username)) {
      state.players.set(username, createPlayerState(username));
    }
    if (state.players.size === 2 && !state.started) {
      state.started = true;
      state.startAtEpochMs = now() + 1200; // stesso margine di MATCH_INIT_LEAD_MS di prima
    }
    return state.players.get(username);
  }

  function removePlayer(username) {
    const player = state.players.get(username);
    if (player && player.respawnTimer) clearTimer(player.respawnTimer);
    state.players.delete(username);
  }

  // Da chiamare quando la stanza viene chiusa (partita conclusa, o entrambi i giocatori usciti):
  // evita che un timer di respawn pendente resti agganciato a un oggetto giocatore ormai orfano
  // (innocuo in un processo server a lungo termine, ma terrebbe vivo inutilmente il processo negli
  // script offline che ne creano ed eseguono molte in sequenza, vedi headless-sim.mjs).
  function destroy() {
    for (const player of state.players.values()) {
      if (player.respawnTimer) clearTimer(player.respawnTimer);
    }
  }

  function setPlayerState(username, payload) {
    const player = state.players.get(username);
    if (!player) return;
    player.x = Number(payload.x) || 0;
    player.y = Number(payload.y) || 0;
    if (Number.isFinite(payload.width) && payload.width > 0) player.width = payload.width;
    if (Number.isFinite(payload.height) && payload.height > 0) player.height = payload.height;
    player.hasState = true;
  }

  function fire(username, payload) {
    const player = state.players.get(username);
    if (!player) return;
    const id = String(payload.id ?? nextArenaId("shot"));
    player.pendingProjectiles.set(id, {
      x: Number(payload.x) || 0,
      y: Number(payload.y) || 0,
      vx: Number(payload.vx) || 0,
      vy: Number(payload.vy) || 0,
      radius: Number.isFinite(payload.radius) ? payload.radius : 4,
    });
  }

  function isVulnerable(player) {
    return !player.respawning && !player.eliminated && now() >= player.invulnerableUntilMs;
  }

  function loseLife(player) {
    if (player.respawning || player.eliminated) return;
    player.lives -= 1;

    if (player.lives <= 0) {
      player.eliminated = true;
      player.eliminatedAtFrame = state.scriptedClock;
      return;
    }

    player.respawning = true;
    // Nel motore originale il respawn era un window.setTimeout lato client. Qui il server e'
    // l'unica autorita' sul "quando torno vulnerabile": lo stesso ritardo, misurato sul proprio
    // orologio, cosi' il client (che nel frattempo esegue la propria sequenza VISIVA identica,
    // vedi LocalGameEngine.loseLife()) non puo' far tornare la navicella colpibile prima del tempo
    // dichiarando semplicemente di essere "respawnata".
    player.respawnTimer = setTimer(() => {
      player.respawning = false;
      player.invulnerableUntilMs = now() + RESPAWN_INVULNERABILITY_MS;
    }, RESPAWN_DELAY_MS);
  }

  function livingPlayers() {
    return [...state.players.values()].filter((p) => !p.eliminated);
  }

  function spawnGrid(columnsMin, columnsMax, rowsMin, rowsMax, canShoot) {
    const columns = Math.floor(rng() * (columnsMax - columnsMin + 1) + columnsMin);
    const rows = Math.floor(rng() * (rowsMax - rowsMin + 1) + rowsMin);
    const invaders = [];
    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        invaders.push({
          id: nextArenaId("invader"),
          x: x * 30,
          y: y * 30,
          width: INVADER_WIDTH,
          height: INVADER_HEIGHT,
        });
      }
    }
    const grid = {
      id: nextArenaId("grid"),
      x: 0,
      y: 0,
      vx: 3,
      vy: 0,
      width: columns * 30,
      invaders,
      canShoot: canShoot !== false,
    };
    state.grids.push(grid);
    return grid;
  }

  // Bersaglio di un nuovo asteroide: un solo punto di mira deciso QUI (a differenza della versione
  // precedente, dove ogni client puntava alla propria navicella locale, facendo divergere la
  // traiettoria della STESSA entita' condivisa sui due schermi) - un giocatore vivo scelto a caso,
  // o il centro del canvas se nessuno e' ancora connesso/vivo.
  function pickAsteroidTarget() {
    const candidates = livingPlayers();
    const pool = candidates.length > 0 ? candidates : [...state.players.values()];
    if (pool.length === 0) return { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    const chosen = pool[Math.floor(rng() * pool.length)];
    return { x: chosen.x + chosen.width / 2, y: chosen.y + chosen.height / 2 };
  }

  function spawnAsteroid() {
    const target = pickAsteroidTarget();
    const radius = rng() * 24 + 18;
    const maxHealth = radius < 26 ? 2 : radius < 34 ? 3 : 4;

    const spawnSide = Math.floor(rng() * 4);
    let startX = 0;
    let startY = 0;
    if (spawnSide === 0) {
      startX = rng() * CANVAS_WIDTH;
      startY = -radius - 20;
    } else if (spawnSide === 1) {
      startX = CANVAS_WIDTH + radius + 20;
      startY = rng() * CANVAS_HEIGHT;
    } else {
      startX = -radius - 20;
      startY = rng() * CANVAS_HEIGHT;
    }

    const angle = Math.atan2(target.y - startY, target.x - startX);
    const speed = rng() * 1.1 + 1.2;

    state.asteroids.push({
      id: nextArenaId("asteroid"),
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      rotation: 0,
      rotationSpeed: (rng() - 0.5) * 0.05,
      health: maxHealth,
      maxHealth,
    });
  }

  function spawnScriptedWave(wave) {
    const grid = spawnGrid(wave.columns, wave.columns, wave.rows, wave.rows, wave.canShoot);
    if (wave.spawnAsteroid) spawnAsteroid();
    state.nextScriptedWaveIndex += 1;
    return grid;
  }

  function updateTestbedWaves(waves) {
    // Le ondate gia' segnate come "eliminate" restano senza invasori (un'eliminazione arrivata
    // dopo la chiusura dell'ondata non deve farla riapparire).
    state.testbedWaveGridId.forEach((gridId, index) => {
      if (state.testbedWaveClearedAtFrame[index] !== undefined) {
        const grid = state.grids.find((g) => g.id === gridId);
        if (grid) grid.invaders.length = 0;
      }
    });
    state.grids = state.grids.filter((g) => g.invaders.length > 0);

    const index = state.nextScriptedWaveIndex;
    const wave = waves[index];
    if (wave) {
      const previousClearedAt = index === 0 ? 0 : state.testbedWaveClearedAtFrame[index - 1];
      if (previousClearedAt !== undefined) {
        const spawnAt =
          index === 0
            ? wave.minStartFrame
            : Math.max(wave.minStartFrame, previousClearedAt + TESTBED_WAVE_SPAWN_DELAY_FRAMES);
        if (state.scriptedClock >= spawnAt) {
          const grid = spawnScriptedWave(wave);
          state.testbedWaveGridId[index] = grid.id;
        }
      }
    }

    state.testbedWaveGridId.forEach((gridId, waveIndex) => {
      if (state.testbedWaveClearedAtFrame[waveIndex] !== undefined) return;
      const grid = state.grids.find((g) => g.id === gridId);
      if (gridId !== undefined && (!grid || grid.invaders.length === 0)) {
        state.testbedWaveClearedAtFrame[waveIndex] = state.scriptedClock;
      }
    });
  }

  function testbedLastWaveClearedAtFrame() {
    const waves = state.config.scriptedWaves;
    if (!waves || waves.length === 0) return null;
    return state.testbedWaveClearedAtFrame[waves.length - 1] ?? null;
  }

  function knownWaveClearFrames() {
    const frames = [];
    for (const frame of state.testbedWaveClearedAtFrame) {
      if (frame === undefined) break;
      frames.push(frame);
    }
    return frames;
  }

  function stopTestbed() {
    if (!state.testbedActive) return;
    state.testbedActive = false;
    state.testbedStoppedAtFrame = state.scriptedClock;
  }

  function finishTestbedMatch(endReason) {
    const players = [...state.players.values()];
    const [p1, p2] = players;
    let outcomeFor = {};
    let decidedBy;

    if (p1 && p2 && p1.eliminated && p2.eliminated) {
      decidedBy = "eliminationOrder";
      const a = p1.eliminatedAtFrame ?? 0;
      const b = p2.eliminatedAtFrame ?? 0;
      if (a < b) {
        outcomeFor[p1.username] = "lose";
        outcomeFor[p2.username] = "win";
      } else if (a > b) {
        outcomeFor[p1.username] = "win";
        outcomeFor[p2.username] = "lose";
      } else {
        outcomeFor[p1.username] = "draw";
        outcomeFor[p2.username] = "draw";
      }
    } else if (p1 && p2 && (p1.eliminated || p2.eliminated)) {
      decidedBy = "survival";
      outcomeFor[p1.username] = p1.eliminated ? "lose" : "win";
      outcomeFor[p2.username] = p2.eliminated ? "lose" : "win";
    } else {
      decidedBy = "score";
      if (p1 && p2) {
        outcomeFor[p1.username] = outcomeByScore(p1.score, p2.score);
        outcomeFor[p2.username] = outcomeByScore(p2.score, p1.score);
      }
    }

    state.ended = true;
    state.result = {
      mode: "testbed",
      endReason,
      decidedBy,
      endFrame: state.scriptedClock,
      lastWaveClearedAtFrame: testbedLastWaveClearedAtFrame(),
      players: players.map((p) => ({
        username: p.username,
        outcome: outcomeFor[p.username] ?? "draw",
        score: p.score,
        eliminated: p.eliminated,
        eliminatedAtFrame: p.eliminatedAtFrame,
        finalPositionX: p.x,
        finalPositionY: p.y,
      })),
    };
  }

  function updateTestbedMatchState() {
    if (state.ended) return;

    const players = [...state.players.values()];
    if (players.length === 2 && players[0].eliminated && players[1].eliminated) {
      stopTestbed();
      finishTestbedMatch("bothEliminated");
      return;
    }

    if (state.testbedActive) {
      const lastWaveClearedAt = testbedLastWaveClearedAtFrame();
      if (lastWaveClearedAt === null || state.scriptedClock < lastWaveClearedAt + TESTBED_END_DELAY_FRAMES) {
        return;
      }
      stopTestbed();
    }

    // Nessuna attesa dello "stato finale dell'avversario": essendoci una sola copia autoritativa
    // dello stato, non esiste piu' un avversario il cui esito puo' non essere ancora arrivato -
    // il server lo conosce sempre per intero, a differenza di ciascun client nella versione
    // precedente (vedi TESTBED_FINAL_STATE_TIMEOUT_MS, rimosso: non serve piu' nulla del genere).
    finishTestbedMatch("lastWaveCleared");
  }

  function finishTimedMatch() {
    const players = [...state.players.values()];
    state.ended = true;
    state.result = {
      mode: "timed",
      endReason: "timeUp",
      decidedBy: "score",
      endFrame: state.scriptedClock,
      lastWaveClearedAtFrame: null,
      players: players.map((p) => {
        const other = players.find((o) => o !== p);
        return {
          username: p.username,
          outcome: other ? outcomeByScore(p.score, other.score) : "draw",
          score: p.score,
          eliminated: p.eliminated,
          eliminatedAtFrame: p.eliminatedAtFrame,
          finalPositionX: p.x,
          finalPositionY: p.y,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Avanza la simulazione di UN frame (1/60s). Va chiamata a passo fisso, come il vecchio
  // LocalGameEngine.animate() - server.js la richiama da un setInterval a FRAME_MS, gli script
  // offline la richiamano da un orologio virtuale.
  // ---------------------------------------------------------------------------------------------
  function tickOnce() {
    // "started" diventa true non appena il secondo giocatore entra nella stanza (vedi addPlayer()),
    // ma la simulazione vera e propria deve restare ferma per lo stesso margine (startAtEpochMs,
    // ~1200ms) che main.ts usa per montare il motore locale sul lato client: altrimenti il campo
    // condiviso (ondate, asteroidi, frame/scriptedClock) avanzerebbe qui per oltre un secondo prima
    // ancora che il client abbia costruito il proprio LocalGameEngine, disallineando il conteggio
    // frame del server (da cui dipendono le ondate scriptate del testbed) rispetto a quello del
    // client (da cui dipende testbed/scenarioPlayer.ts per decidere quando premere i tasti).
    if (!state.started || state.ended || state.startAtEpochMs === null || now() < state.startAtEpochMs) return;

    const players = [...state.players.values()];

    // --- asteroidi: movimento, uscita dallo schermo, collisione con giocatori vulnerabili,
    // collisione con i proiettili (pendenti) di ciascun giocatore ---
    for (let i = state.asteroids.length - 1; i >= 0; i--) {
      const asteroid = state.asteroids[i];
      asteroid.rotation += asteroid.rotationSpeed;
      asteroid.x += asteroid.vx;
      asteroid.y += asteroid.vy;

      if (
        asteroid.y - asteroid.radius > CANVAS_HEIGHT + 60 ||
        asteroid.y + asteroid.radius < -60 ||
        asteroid.x - asteroid.radius > CANVAS_WIDTH + 60 ||
        asteroid.x + asteroid.radius < -60
      ) {
        state.asteroids.splice(i, 1);
        continue;
      }

      let consumed = false;
      for (const player of players) {
        if (!player.hasState || !isVulnerable(player)) continue;
        const cx = player.x + player.width / 2;
        const cy = player.y + player.height / 2;
        const dist = hypot(asteroid.x - cx, asteroid.y - cy);
        const playerRadiusApprox = Math.max(player.width, player.height) / 2.5;
        if (dist < asteroid.radius + playerRadiusApprox) {
          state.asteroids.splice(i, 1);
          loseLife(player);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      for (const player of players) {
        for (const [shotId, shot] of player.pendingProjectiles) {
          const dist = hypot(shot.x - asteroid.x, shot.y - asteroid.y);
          if (dist < shot.radius + asteroid.radius) {
            player.pendingProjectiles.delete(shotId);
            asteroid.health -= 1;
            if (asteroid.health <= 0) {
              player.score += asteroid.maxHealth * 70;
              state.asteroids.splice(i, 1);
            }
            consumed = true;
            break;
          }
        }
        if (consumed) break;
      }
    }

    // --- proiettili nemici: movimento, uscita dallo schermo, collisione con giocatori vulnerabili
    // (stesso test "generoso" - nessun limite superiore sulla y - gia' presente nella versione
    // originale: non e' stato corretto qui perche' non e' l'oggetto di questa modifica, solo
    // spostato di autorita') ---
    for (let i = state.invaderProjectiles.length - 1; i >= 0; i--) {
      const ip = state.invaderProjectiles[i];
      if (ip.y > CANVAS_HEIGHT) {
        state.invaderProjectiles.splice(i, 1);
        continue;
      }
      ip.x += ip.vx;
      ip.y += ip.vy;

      for (const player of players) {
        if (!player.hasState || !isVulnerable(player)) continue;
        if (
          ip.y + ip.height >= player.y &&
          ip.x + ip.width >= player.x &&
          ip.x <= player.x + player.width
        ) {
          state.invaderProjectiles.splice(i, 1);
          loseLife(player);
          break;
        }
      }
    }

    // --- griglie di invasori: movimento, sparo periodico, collisione con giocatori vulnerabili,
    // collisione con i proiettili pendenti di ciascun giocatore ---
    //
    // NOTA sulla rappresentazione: "grid.x/grid.y" qui non e' la posizione di un contenitore che
    // gli invasori seguono per offset - e' solo il segnalibro di bordo usato per il test di
    // rimbalzo (equivalente di Grid.position nell'originale), ricalcolato da capo (ribasato
    // sull'invasore piu' a sinistra rimasto) ogni volta che un invasore viene eliminato, esattamente
    // come faceva LocalGameEngine dopo ogni uccisione. Ogni invasore ha una posizione ASSOLUTA
    // propria (invader.x/invader.y), spostata ogni frame della stessa velocita' della griglia -
    // stesso schema dell'originale (Invader.update({velocity: grid.velocity})), compreso il
    // dettaglio per cui, nel frame esatto in cui la griglia rimbalza, gli invasori si spostano gia'
    // con la velocita' APPENA invertita mentre il segnalibro di bordo si e' mosso ancora con quella
    // vecchia (ordine di chiamata identico all'originale: prima grid.update(), poi il ciclo
    // invasori) - un disallineamento di pochi pixel che l'originale stesso si auto-corregge ad ogni
    // uccisione tramite il ribasamento, quindi non e' stato "corretto" qui.
    for (let gridIndex = state.grids.length - 1; gridIndex >= 0; gridIndex--) {
      const grid = state.grids[gridIndex];

      grid.x += grid.vx;
      grid.y += grid.vy;
      grid.vy = 0;
      if (grid.x + grid.width >= CANVAS_WIDTH || grid.x <= 0) {
        grid.vx = -grid.vx;
        grid.vy = 30;
      }

      for (const invader of grid.invaders) {
        invader.x += grid.vx;
        invader.y += grid.vy;
      }

      if (state.frames > 0 && state.frames % 60 === 0 && grid.invaders.length > 0 && grid.canShoot) {
        const shooter = grid.invaders[Math.floor(rng() * grid.invaders.length)];
        state.invaderProjectiles.push({
          id: nextArenaId("invproj"),
          x: shooter.x + shooter.width / 2,
          y: shooter.y + shooter.height,
          vx: 0,
          vy: 6,
          width: 3,
          height: 10,
        });
      }

      let removedAny = false;
      for (let i = grid.invaders.length - 1; i >= 0; i--) {
        const invader = grid.invaders[i];

        let killed = false;
        for (const player of players) {
          if (!player.hasState || !isVulnerable(player)) continue;
          if (
            player.x < invader.x + invader.width &&
            player.x + player.width > invader.x &&
            player.y < invader.y + invader.height &&
            player.y + player.height > invader.y
          ) {
            grid.invaders.splice(i, 1);
            removedAny = true;
            loseLife(player);
            killed = true;
            break;
          }
        }
        if (killed) continue;

        for (const player of players) {
          for (const [shotId, shot] of player.pendingProjectiles) {
            if (
              shot.y - shot.radius <= invader.y + invader.height &&
              shot.x + shot.radius >= invader.x &&
              shot.x - shot.radius <= invader.x + invader.width &&
              shot.y + shot.radius >= invader.y
            ) {
              player.pendingProjectiles.delete(shotId);
              player.score += 100;
              grid.invaders.splice(i, 1);
              removedAny = true;
              killed = true;
              break;
            }
          }
          if (killed) break;
        }
      }

      // Ribasa il segnalibro di bordo della griglia (grid.x/width) sull'invasore piu' a sinistra
      // rimasto, esattamente come faceva l'originale dopo ogni eliminazione - senza questo passo il
      // test di rimbalzo (sopra, all'inizio del giro) continuerebbe a usare il bordo di una
      // formazione che non esiste piu'.
      if (removedAny && grid.invaders.length > 0) {
        const first = grid.invaders[0];
        const last = grid.invaders[grid.invaders.length - 1];
        grid.width = last.x - first.x + last.width;
        grid.x = first.x;
      }
    }
    // Le griglie rimaste senza invasori vengono tolte subito nella partita "timed"; nel testbed la
    // pulizia e' compito di updateTestbedWaves() (chiamata poco piu' sotto), che deve prima
    // confrontarle con testbedWaveGridId per registrare il frame di eliminazione dell'ondata.
    if (state.matchMode !== "testbed") {
      state.grids = state.grids.filter((g) => g.invaders.length > 0);
    }

    // --- proiettili "scaduti" dei giocatori (usciti dallo schermo senza aver colpito nulla) ---
    for (const player of players) {
      for (const [shotId, shot] of player.pendingProjectiles) {
        shot.x += shot.vx;
        shot.y += shot.vy;
        if (shot.y + shot.radius <= 0 || shot.y - shot.radius >= CANVAS_HEIGHT) {
          player.pendingProjectiles.delete(shotId);
        }
      }
    }

    // --- spawn di nuove ondate/asteroidi ---
    if (state.config.scriptedWaves && state.config.scriptedWaves.length > 0) {
      if (state.matchMode === "testbed") {
        updateTestbedWaves(state.config.scriptedWaves);
      } else {
        const nextWave = state.config.scriptedWaves[state.nextScriptedWaveIndex];
        if (nextWave && state.grids.length === 0 && state.scriptedClock >= nextWave.minStartFrame) {
          spawnScriptedWave(nextWave);
        }
      }
    } else if (state.frames > 0 && state.frames % state.randomInterval === 0) {
      spawnGrid(state.config.gridColumnsMin, state.config.gridColumnsMax, state.config.gridRowsMin, state.config.gridRowsMax, true);
      state.randomInterval = randomIntervalIn(rng, state.config.gridSpawnIntervalFramesMin, state.config.gridSpawnIntervalFramesMax);
      state.frames = 0;
    }

    if (state.config.scriptedAsteroids) {
      const nextEvent = state.config.scriptedAsteroids[state.nextScriptedAsteroidIndex];
      if (nextEvent && state.scriptedClock >= nextEvent.minStartFrame) {
        spawnAsteroid();
        state.nextScriptedAsteroidIndex += 1;
      }
    }

    if (
      state.config.asteroidsEnabled &&
      state.frames > 0 &&
      state.frames % state.asteroidSpawnInterval === 0 &&
      (state.config.asteroidMaxCount === undefined || state.asteroidsSpawned < state.config.asteroidMaxCount)
    ) {
      spawnAsteroid();
      state.asteroidsSpawned += 1;
      state.asteroidSpawnInterval = randomIntervalIn(
        rng,
        state.config.asteroidSpawnIntervalFramesMin,
        state.config.asteroidSpawnIntervalFramesMax,
      );
    }

    state.scriptedClock += 1;
    state.frames += 1;
    state.tick += 1;

    // --- fine partita ---
    if (state.matchMode === "testbed") {
      updateTestbedMatchState();
    } else if (state.startAtEpochMs !== null && now() - state.startAtEpochMs >= MATCH_DURATION_MS) {
      finishTimedMatch();
    }
  }

  function getRemainingMs() {
    if (state.matchMode !== "timed" || state.startAtEpochMs === null) return null;
    return Math.max(0, MATCH_DURATION_MS - (now() - state.startAtEpochMs));
  }

  function getSnapshot() {
    const playersOut = {};
    for (const [username, p] of state.players) {
      playersOut[username] = {
        score: p.score,
        lives: Math.max(0, p.lives),
        eliminated: p.eliminated,
      };
    }
    return {
      tick: state.tick,
      remainingMs: getRemainingMs(),
      invaders: state.grids.flatMap((g) => g.invaders.map((inv) => ({ id: inv.id, x: inv.x, y: inv.y }))),
      asteroids: state.asteroids.map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        rotation: a.rotation,
        radius: a.radius,
        health: a.health,
        maxHealth: a.maxHealth,
      })),
      invaderProjectiles: state.invaderProjectiles.map((ip) => ({ id: ip.id, x: ip.x, y: ip.y })),
      players: playersOut,
      wavesClearedAtFrame: state.matchMode === "testbed" ? knownWaveClearFrames() : undefined,
    };
  }

  return {
    matchMode,
    addPlayer,
    removePlayer,
    setPlayerState,
    fire,
    tickOnce,
    getSnapshot,
    destroy,
    hasStarted: () => state.started,
    startAtEpochMs: () => state.startAtEpochMs,
    isEnded: () => state.ended,
    getResult: () => state.result,
    playerCount: () => state.players.size,
  };
}

module.exports = {
  createRoom,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FRAME_MS,
  MATCH_DURATION_MS,
  LIVES_PER_PLAYER,
  TESTBED_LIVES_PER_PLAYER,
  DEFAULT_GAME_CONFIG,
  mulberry32,
};
