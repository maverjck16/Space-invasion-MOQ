// STATO (1v1 - server autoritativo): questo generatore e' storico/congelato, non eseguibile cosi'
// com'e' con l'attuale scripts/headless-sim.mjs. Il bot AI che autora le timeline sotto legge lo
// stato di simulazione INTERNO del vecchio LocalGameEngine lato client (griglie/asteroidi/
// proiettili come riferimenti a oggetti JS del motore, tramite createSimClient/
// buildSimulationBundles) per decidere dove muoversi/schivare/sparare: quel motore-client non
// simula piu' nulla (l'arena condivisa vive ora solo in arena-server/simulation.js, vedi il
// commento in cima a simulation.js), quindi quegli export non esistono piu' in headless-sim.mjs e
// questo file non puo' piu' importarli.
//
// I DUE FILE GIA' GENERATI (frontend/public/scenarios/scenario-1.json e scenario-2.json) restano
// pero' pienamente validi: la timeline di azioni registrata al loro interno (players.A/B.actions)
// e' un semplice elenco fisso di input con relativo frame di invio, riproducibile da
// ScenarioPlayer indipendentemente da come e' stata generata - e la riproducibilita' bit-per-bit
// di entrambi contro il nuovo arena-server/simulation.js e' stata riverificata con
// "node scripts/verify-determinism.mjs" dopo la conversione. Non serve quindi rigenerarli per
// continuare a usare il testbed con l'architettura attuale.
//
// Se in futuro servissero NUOVI scenari, questo file andrebbe riscritto per far decidere al bot le
// proprie mosse leggendo un ArenaSnapshot (invasori/asteroidi/proiettili/vite cosi' come li vede
// un client reale, vedi arena/arenaClient.ts) invece dello stato interno del motore - un lavoro
// separato dalla conversione dell'architettura, non necessario per il funzionamento del testbed con
// i due scenari esistenti. Il resto di questo file (euristica del bot, struttura delle ondate) resta
// comunque valido come descrizione di COME i due scenari attuali sono stati originariamente
// prodotti, utile ai fini della tesi anche se non piu' eseguibile.
//
// ---------------------------------------------------------------------------------------------
//
// Genera i 2 file di scenario deterministico (scenario-1.json, scenario-2.json) usati dal
// testbed al posto del controllo manuale da tastiera (vedi frontend/src/testbed/scenarioPlayer.ts
// e frontend/src/testbed/scenario.types.ts per lo schema).
//
//  Ogni scenario contiene DUE timeline di input indipendenti (players.A / players.B): stesso seed
// RNG (quindi stesso "mondo") ma comportamenti diversi. Il campo "expected" viene lasciato vuoto
// qui: e' scripts/verify-determinism.mjs (che usa il simulatore headless reale,
// scripts/headless-sim.mjs) a calcolarlo e scriverlo, cosi' il valore atteso e' sempre generato
// eseguendo DAVVERO il motore di gioco, mai a mano.
//
//  Esegui con: node scripts/generate-scenario.mjs
// poi: node scripts/verify-determinism.mjs --write --repeat 5   (calcola gli "expected" e verifica
// il determinismo)
//
//  Questo script e' mantenuto byte-per-byte identico tra il testbed MoQ e quello WebRTC (vedi
// TESTBED.md): individua da solo la cartella "frontend" corretta (TS/frontend per MoQ, frontend
// per WebRTC - una differenza storica di struttura tra i due progetti) e scrive in
// <frontend>/public/scenarios/scenario-N.json in entrambi, cosi' lo stesso comando produce file
// byte-identici nei due repository (verificabile con "diff").
//
//  Schema delle partite (uguale per i due scenari, scenario-2 aggiunge un asteroide in ogni fase):
// 10 s di movimento libero senza nemici, poi un'ondata di 4 righe x 7 alieni che NON sparano, poi
// una riga di 10 alieni che spara e infine una seconda riga di 10 alieni che spara, uguale alla
// precedente. Ogni ondata compare solo dopo che la precedente e' stata eliminata per intero (vedi
// "scriptedWaves" e LocalGameEngine.updateTestbedWaves()).
//
//  TESTBED 1v1: nella partita automatica i due giocatori condividono l'arena e hanno una sola vita
// (vedi LocalGameEngine.updateTestbedMatchState()). Le timeline "a schema fisso" delle versioni
// precedenti (spazzata continua da un lato all'altro + sparo a cadenza fissa) non schivano nulla:
// con una sola vita i giocatori venivano eliminati quasi sempre durante le righe che sparano, e in
// scenario-2 gia' dal primo asteroide. Le timeline vengono quindi REGISTRATE da due giocatori
// automatici ("bot") che giocano una partita simulata offline sul motore reale (stesso simulatore di
// headless-sim.mjs, rete ideale): a ogni frame il bot legge lo stato dell'arena, sceglie dove
// andare (mira a un invasore della propria meta' della formazione, A da sinistra e B da destra),
// evita proiettili nemici, asteroidi e invasori con un margine di sicurezza e spara quando il colpo
// puo' andare a segno. Ogni cambio di tasto diventa un'azione della timeline, con il frame in cui
// va inviata: il file prodotto resta una normale sequenza fissa di input, che ScenarioPlayer
// riproduce frame per frame senza nessuna logica aggiuntiva nel browser.
//  Dopo la generazione lo script riproduce le due timeline con headless-sim.mjs e controlla che la
// partita sia identica a quella registrata (altrimenti si ferma con un errore).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  FRAME_MS,
  buildSimulationBundles,
  createSimClient,
  createVirtualClock,
  runOneMatch,
} from "./headless-sim.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(__dirname);

function resolveOutDir() {
  const candidates = [path.join(projectRoot, "TS", "frontend", "public"), path.join(projectRoot, "frontend", "public")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.join(candidate, "scenarios");
  }
  throw new Error(`Impossibile trovare la cartella public/ (provati: ${candidates.join(", ")})`);
}

// -------------------------------------------------------------------------------------------
// Costanti del motore di gioco usate dai bot per prevedere i movimenti (vedi
// game/localGame/LocalGameEngine.ts ed entities/*.ts). Posizioni e dimensioni vengono invece
// lette direttamente dallo stato del motore a ogni frame.
// -------------------------------------------------------------------------------------------
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 576;
const PLAYER_SPEED_X = 7;
const PLAYER_SPEED_Y = 3;
const PLAYER_PROJECTILE_SPEED = 10;
const PLAYER_PROJECTILE_RADIUS = 4;
const GRID_BOUNCE_DROP = 30;
const PHASE1_END_MS = 10000;

// -------------------------------------------------------------------------------------------
// FASE 1 (0 - PHASE1_END_MS): "per 10s la navicella si muove a sinistra a destra in alto e in
// basso e spara qualche colpo" - nessun invasore a schermo (le ondate iniziano dopo, vedi
// scriptedWaves.minStartFrame). Stesso schema di movimento delle versioni precedenti, espresso come
// direzione desiderata in funzione del tempo: il bot lo segue finche' non deve schivare qualcosa
// (in scenario-2 c'e' un asteroide a t = 5 s).
// -------------------------------------------------------------------------------------------
function freeRoamDirection(timeMs, startDir) {
  const otherDir = startDir === "left" ? "right" : "left";
  let x = "none";
  if (timeMs < 1600) x = startDir;
  else if (timeMs < 3600) x = otherDir;
  else if (timeMs < 5200) x = startDir;
  else if (timeMs < 7200) x = otherDir;
  else if (timeMs < PHASE1_END_MS - 400) x = startDir;

  let y = "none";
  if (timeMs >= 3200 && timeMs < 3500) y = "down";
  else if (timeMs >= 6800 && timeMs < 7100) y = "up";

  return { x, y };
}

// -------------------------------------------------------------------------------------------
// Previsione del moto delle entita' dell'arena, con le stesse regole di aggiornamento del motore.
// -------------------------------------------------------------------------------------------
function snapshotGrid(grid) {
  return {
    x: grid.position.x,
    vx: grid.velocity.x,
    vy: grid.velocity.y,
    width: grid.width,
    invaders: grid.invaders.map((invader) => ({
      ref: invader,
      x: invader.position.x,
      y: invader.position.y,
      w: invader.width,
      h: invader.height,
    })),
  };
}

// Un frame di Grid.update() seguito da Invader.update() per ogni invasore (vedi entities/Grid.ts).
function stepGrid(grid) {
  grid.x += grid.vx;
  grid.vy = 0;
  if (grid.x + grid.width >= CANVAS_WIDTH || grid.x <= 0) {
    grid.vx = -grid.vx;
    grid.vy = GRID_BOUNCE_DROP;
  }
  for (const invader of grid.invaders) {
    invader.x += grid.vx;
    invader.y += grid.vy;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const DIR_X = { left: -1, none: 0, right: 1 };
const DIR_Y = { up: -1, none: 0, down: 1 };

// -------------------------------------------------------------------------------------------
// Bot: decide a ogni frame direzione orizzontale/verticale e se sparare.
// -------------------------------------------------------------------------------------------
const PLAN_HORIZON_FRAMES = 60;
// Se la direzione desiderata non incontra pericoli per almeno questi frame la si segue: il bot
// ripianifica a ogni frame, quindi un pericolo piu' lontano verra' gestito piu' avanti.
const SAFE_FRAMES = 22;
// Durate (in frame) dei piani "muoviti per k frame e poi fermati" valutati per schivare.
const PARTIAL_MOVE_FRAMES = [3, 6, 10, 15, 22];
// Tolleranza di allineamento con il punto di mira, in px (mezzo passo orizzontale).
const AIM_TOLERANCE_PX = 3.5;

class TestbedBot {
  constructor(params) {
    this.params = params;
    this.current = { x: "none", y: "none" };
    this.lastShotAtMs = -Infinity;
    this.nextScriptedShot = 0;
    this.gridColumns = new WeakMap();
    this.ignoredAsteroids = new WeakSet();
    this.knownAsteroids = new WeakSet();
  }

  // Asteroidi da non schivare (parametro ignoreAsteroidsOfWaves): quelli che compaiono insieme alle
  // ondate indicate (indice in gameConfig.scriptedWaves). Il bot li riconosce nel frame in cui li
  // vede per la prima volta, che e' lo stesso in cui l'ondata compare.
  classifyAsteroids(engine) {
    const ignored = this.params.ignoreAsteroidsOfWaves ?? [];
    for (const asteroid of engine.asteroids) {
      if (this.knownAsteroids.has(asteroid)) continue;
      this.knownAsteroids.add(asteroid);
      const spawnedWithWave = engine.nextScriptedWaveIndex - 1;
      if (ignored.includes(spawnedWithWave) && engine.grids.some((grid) => grid.invaders.length > 0)) {
        this.ignoredAsteroids.add(asteroid);
      }
    }
  }

  // Direzione desiderata in assenza di pericoli.
  desiredDirection(engine, nowMs) {
    const player = engine.localPlayer;
    if (nowMs < PHASE1_END_MS) return freeRoamDirection(nowMs, this.params.startDir);

    // Ultima ondata eliminata: si resta fermi (schivando solo se serve) fino alla fine della
    // partita, cosi' la posizione finale non dipende dal frame esatto in cui la partita si chiude.
    if (engine.testbedLastWaveClearedAtFrame() !== null) return { x: "none", y: "none" };

    const bottomY = CANVAS_HEIGHT - player.height;
    const y = player.position.y < bottomY - 0.5 ? "down" : "none";

    const targetX = this.aimX(engine) ?? this.homeX(player);
    const dx = targetX - player.position.x;
    let x = "none";
    if (dx > AIM_TOLERANCE_PX) x = "right";
    else if (dx < -AIM_TOLERANCE_PX) x = "left";
    return { x, y };
  }

  homeX(player) {
    return this.params.side === "left"
      ? CANVAS_WIDTH * 0.25 - player.width / 2
      : CANVAS_WIDTH * 0.75 - player.width / 2;
  }

  // Colonna di ciascun invasore nella formazione iniziale, calcolata la prima volta che il bot vede
  // la griglia (subito dopo la sua comparsa, quando e' ancora completa).
  columnsOf(grid) {
    let columns = this.gridColumns.get(grid);
    if (!columns) {
      const minX = Math.min(...grid.invaders.map((invader) => invader.position.x));
      columns = new Map(grid.invaders.map((invader) => [invader, Math.round((invader.position.x - minX) / 30)]));
      this.gridColumns.set(grid, columns);
    }
    return columns;
  }

  // Posizione orizzontale (bordo sinistro della navicella) da cui un colpo raggiunge l'invasore
  // scelto: la colonna piu' a sinistra (A) o piu' a destra (B) ancora occupata e, in quella
  // colonna, l'invasore piu' in basso, cioe' il primo che un colpo incontra. Tiene conto del
  // tempo per arrivare in posizione e del volo del proiettile, durante i quali la griglia si muove.
  aimX(engine) {
    const player = engine.localPlayer;
    let best = null;
    for (const grid of engine.grids) {
      if (grid.invaders.length === 0) continue;
      const columns = this.columnsOf(grid);
      for (const invader of grid.invaders) {
        const column = columns.get(invader) ?? 0;
        const key = this.params.side === "left" ? column : -column;
        if (!best || key < best.key || (key === best.key && invader.position.y > best.invader.position.y)) {
          best = { key, grid, invader };
        }
      }
    }
    if (!best) return null;

    const shotY = player.position.y - 5;
    let moveFrames = 0;
    let aim = player.position.x;
    for (let iteration = 0; iteration < 4; iteration++) {
      const future = snapshotGrid(best.grid);
      const target = future.invaders.find((entry) => entry.ref === best.invader);
      let hit = false;
      for (let frame = 1; frame <= 400; frame++) {
        stepGrid(future);
        if (frame <= moveFrames) continue;
        const projectileY = shotY - PLAYER_PROJECTILE_SPEED * (frame - moveFrames);
        if (projectileY - PLAYER_PROJECTILE_RADIUS <= target.y + target.h) {
          hit = true;
          break;
        }
      }
      if (!hit) break;
      aim = clamp(target.x + target.w / 2 - player.width / 2, 0, CANVAS_WIDTH - player.width);
      const nextMoveFrames = Math.ceil(Math.abs(aim - player.position.x) / PLAYER_SPEED_X);
      if (nextMoveFrames === moveFrames) break;
      moveFrames = nextMoveFrames;
    }
    return aim;
  }

  // Primo frame (1..PLAN_HORIZON_FRAMES) in cui la navicella verrebbe colpita seguendo il piano
  // (xDir, yDir) per "moveFrames" frame e poi fermandosi in orizzontale; Infinity se il piano e'
  // sicuro. Riproduce l'ordine del motore: in ogni frame asteroidi, proiettili nemici e invasori si
  // muovono e vengono confrontati con la posizione della navicella del frame precedente, poi la
  // navicella si sposta.
  firstDangerFrame(engine, plan) {
    const { projectileMarginPx, asteroidMarginPx, invaderMarginPx } = this.params;
    const player = engine.localPlayer;
    const width = player.width;
    const height = player.height;
    let px = player.position.x;
    let py = player.position.y;

    const projectiles = engine.invaderProjectiles.map((projectile) => ({
      x: projectile.position.x,
      y: projectile.position.y,
      vy: projectile.velocity.y,
      w: projectile.width,
      h: projectile.height,
      gone: false,
    }));
    const asteroids = engine.asteroids
      .filter((asteroid) => !this.ignoredAsteroids.has(asteroid))
      .map((asteroid) => ({
        x: asteroid.position.x,
        y: asteroid.position.y,
        vx: asteroid.velocity.x,
        vy: asteroid.velocity.y,
        r: asteroid.radius,
        gone: false,
      }));
    const grids = engine.grids.filter((grid) => grid.invaders.length > 0).map(snapshotGrid);
    const playerRadius = Math.max(width, height) / 2.5;

    for (let frame = 1; frame <= PLAN_HORIZON_FRAMES; frame++) {
      const centerX = px + width / 2;
      const centerY = py + height / 2;

      for (const asteroid of asteroids) {
        if (asteroid.gone) continue;
        asteroid.x += asteroid.vx;
        asteroid.y += asteroid.vy;
        if (
          asteroid.y - asteroid.r > CANVAS_HEIGHT + 60 ||
          asteroid.y + asteroid.r < -60 ||
          asteroid.x - asteroid.r > CANVAS_WIDTH + 60 ||
          asteroid.x + asteroid.r < -60
        ) {
          asteroid.gone = true;
          continue;
        }
        if (Math.hypot(asteroid.x - centerX, asteroid.y - centerY) < asteroid.r + playerRadius + asteroidMarginPx) {
          return frame;
        }
      }

      for (const projectile of projectiles) {
        if (projectile.gone || this.params.ignoreProjectiles) continue;
        if (projectile.y > CANVAS_HEIGHT) {
          projectile.gone = true;
          continue;
        }
        projectile.y += projectile.vy;
        if (
          projectile.y + projectile.h >= py - 2 &&
          projectile.x + projectile.w >= px - projectileMarginPx &&
          projectile.x <= px + width + projectileMarginPx
        ) {
          return frame;
        }
      }

      for (const grid of grids) {
        stepGrid(grid);
        for (const invader of grid.invaders) {
          if (
            px - invaderMarginPx < invader.x + invader.w &&
            px + width + invaderMarginPx > invader.x &&
            py - invaderMarginPx < invader.y + invader.h &&
            py + height + invaderMarginPx > invader.y
          ) {
            return frame;
          }
        }
      }

      const xDir = frame <= plan.moveFrames ? DIR_X[plan.x] : 0;
      px = clamp(px + PLAYER_SPEED_X * xDir, 0, CANVAS_WIDTH - width);
      py = clamp(py + PLAYER_SPEED_Y * DIR_Y[plan.y], 0, CANVAS_HEIGHT - height);
    }
    return Infinity;
  }

  // Sceglie la direzione per il prossimo frame: quella desiderata se e' sicura, altrimenti il piano
  // che rimanda piu' a lungo il pericolo (a parita', il piu' vicino a quello desiderato).
  chooseDirection(engine, nowMs) {
    this.classifyAsteroids(engine);
    const desired = this.desiredDirection(engine, nowMs);
    const desiredPlan = { ...desired, moveFrames: Infinity };
    if (this.firstDangerFrame(engine, desiredPlan) > SAFE_FRAMES) return desired;

    const currentPlan = { ...this.current, moveFrames: Infinity };
    if (this.firstDangerFrame(engine, currentPlan) > SAFE_FRAMES) return this.current;

    const plans = [];
    for (const y of ["none", "down", "up"]) {
      for (const x of ["none", "left", "right"]) {
        plans.push({ x, y, moveFrames: Infinity });
        if (x !== "none") {
          for (const moveFrames of PARTIAL_MOVE_FRAMES) plans.push({ x, y, moveFrames });
        }
      }
    }

    let best = null;
    for (const plan of plans) {
      const danger = this.firstDangerFrame(engine, plan);
      const distance = (plan.x === desired.x ? 0 : 2) + (plan.y === desired.y ? 0 : 1);
      if (
        !best ||
        danger > best.danger ||
        (danger === best.danger && distance < best.distance)
      ) {
        best = { plan, danger, distance };
      }
    }
    return { x: best.plan.x, y: best.plan.y };
  }

  // true se un colpo sparato adesso colpirebbe un invasore o un asteroide (entro l'uscita dallo
  // schermo del proiettile).
  shotWouldHit(engine) {
    const player = engine.localPlayer;
    const shotX = player.position.x + player.width / 2;
    let shotY = player.position.y - 5;
    const grids = engine.grids.filter((grid) => grid.invaders.length > 0).map(snapshotGrid);
    const asteroids = engine.asteroids.map((asteroid) => ({
      x: asteroid.position.x,
      y: asteroid.position.y,
      vx: asteroid.velocity.x,
      vy: asteroid.velocity.y,
      r: asteroid.radius,
    }));
    for (let frame = 1; shotY + PLAYER_PROJECTILE_RADIUS > 0 && frame < 120; frame++) {
      for (const asteroid of asteroids) {
        asteroid.x += asteroid.vx;
        asteroid.y += asteroid.vy;
      }
      shotY -= PLAYER_PROJECTILE_SPEED;
      for (const asteroid of asteroids) {
        if (Math.hypot(shotX - asteroid.x, shotY - asteroid.y) < PLAYER_PROJECTILE_RADIUS + asteroid.r) return true;
      }
      for (const grid of grids) {
        stepGrid(grid);
        for (const invader of grid.invaders) {
          if (
            shotY - PLAYER_PROJECTILE_RADIUS <= invader.y + invader.h &&
            shotX + PLAYER_PROJECTILE_RADIUS >= invader.x &&
            shotX - PLAYER_PROJECTILE_RADIUS <= invader.x + invader.w &&
            shotY + PLAYER_PROJECTILE_RADIUS >= invader.y
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  wantsToShoot(engine, nowMs) {
    if (nowMs < PHASE1_END_MS) {
      const scripted = this.params.freeRoamShotsAtMs[this.nextScriptedShot];
      if (scripted !== undefined && nowMs >= scripted) {
        this.nextScriptedShot += 1;
        return true;
      }
      return false;
    }
    if (nowMs - this.lastShotAtMs < this.params.shootIntervalMs) return false;
    return this.shotWouldHit(engine);
  }
}

// -------------------------------------------------------------------------------------------
// Registrazione delle azioni. Ogni azione ha il frame all'inizio del quale va inviata (vedi la
// modalita' a frame di src/testbed/scenarioPlayer.ts) e viene inviata qui con la stessa identica
// sequenza di eventi di tastiera che produrra' ScenarioPlayer, cosi' la timeline registrata
// riproduce esattamente la stessa partita. "timeMs" (meta' del frame precedente) resta per
// leggibilita' e per la modalita' a tempo.
// -------------------------------------------------------------------------------------------
class ActionRecorder {
  constructor(client) {
    this.client = client;
    this.actions = [];
    this.moveCount = 0;
    this.shotCount = 0;
    this.currentX = "none";
    this.currentY = "none";
  }

  record(frame, type, extra = {}) {
    const id =
      type === "shoot"
        ? `shot_${String(++this.shotCount).padStart(4, "0")}`
        : `input_${String(++this.moveCount).padStart(4, "0")}`;
    const timeMs = Math.max(0, Math.round((frame - 0.5) * FRAME_MS));
    const action = { id, timeMs, frame, type, ...extra };
    this.actions.push(action);
    this.run(action);
  }

  run(action) {
    const { client } = this;
    if (action.type === "moveX") {
      if (this.currentX !== "none") client.dispatchKey("keyup", this.currentX === "left" ? "a" : "d");
      this.currentX = action.dir;
      if (action.dir !== "none") client.dispatchKey("keydown", action.dir === "left" ? "a" : "d");
      return;
    }
    if (action.type === "moveY") {
      if (this.currentY !== "none") client.dispatchKey("keyup", this.currentY === "up" ? "w" : "s");
      this.currentY = action.dir;
      if (action.dir !== "none") client.dispatchKey("keydown", action.dir === "up" ? "w" : "s");
      return;
    }
    client.dispatchKey("keydown", " ");
    client.dispatchKey("keyup", " ");
  }
}

// Margine tra la fine della partita registrata e la fine della timeline: in un run reale la
// partita puo' chiudersi qualche frame dopo (attesa dello stato finale dell'avversario).
const TIMELINE_TAIL_MS = 5000;
// Limite di sicurezza della partita simulata.
const MAX_MATCH_MS = 240000;

//  Gioca offline la partita dello scenario con i due bot e restituisce le timeline registrate.
// La simulazione e' la stessa di headless-sim.mjs (runOneMatch): stesso orologio virtuale, stessi
// contesti isolati, stessa consegna degli snapshot (latenza 0), stesso ordine di creazione.
function recordMatch(bundles, definition) {
  const clock = createVirtualClock();
  const ids = ["A", "B"];
  const players = {};

  for (const id of ids) {
    players[id] = {
      client: createSimClient({
        name: id,
        clock,
        bundleCodes: [bundles.gameBundleCode, bundles.scenarioBundleCode, bundles.engineBundleCode],
      }),
      bot: new TestbedBot(definition.bots[id]),
      engine: null,
      result: null,
    };
  }

  for (const id of ids) {
    const player = players[id];
    const opponent = players[id === "A" ? "B" : "A"];
    player.client.installRandom(definition.seed);
    const { LocalGameEngine } = player.client.global("__testbedEngine");
    player.recorder = new ActionRecorder(player.client);
    player.engine = new LocalGameEngine({
      canvas: player.client.canvas,
      onSnapshot: (snapshot) => {
        const payload = JSON.stringify(snapshot);
        clock.setTimeout(() => opponent.engine?.applyRemoteSnapshot(JSON.parse(payload)), 0);
      },
      onScoreChange: undefined,
      onLivesChange: undefined,
      onMatchEnd: (result) => {
        if (!player.result) player.result = { ...JSON.parse(JSON.stringify(result)), endedAtMs: clock.now() };
      },
      onTimeRemaining: undefined,
      gameConfig: definition.gameConfig,
      matchMode: "testbed",
      // Il bot decide all'inizio di ogni frame, con lo stato lasciato dal frame precedente, e i
      // suoi comandi agiscono gia' su questo frame (come faranno le azioni registrate).
      onBeforeFrame: (frame) => {
        const { engine, bot, recorder } = player;
        if (engine.game.eliminated) return;
        const frameMs = frame * FRAME_MS;

        const direction = bot.chooseDirection(engine, frameMs);
        if (direction.x !== bot.current.x) recorder.record(frame, "moveX", { dir: direction.x });
        if (direction.y !== bot.current.y) recorder.record(frame, "moveY", { dir: direction.y });
        bot.current = direction;

        if (bot.wantsToShoot(engine, frameMs)) {
          recorder.record(frame, "shoot");
          bot.lastShotAtMs = frameMs;
        }
      },
    });
    player.engine.start();
    player.client.flushImageLoads();
  }

  while ((!players.A.result || !players.B.result) && clock.now() < MAX_MATCH_MS) {
    clock.step(FRAME_MS);
    for (const id of ids) players[id].client.flushImageLoads();
  }

  for (const id of ids) players[id].engine.destroy();

  if (!players.A.result || !players.B.result) {
    throw new Error(`${definition.scenarioId}: la partita registrata non si e' conclusa entro ${MAX_MATCH_MS} ms.`);
  }

  const matchEndMs = Math.max(players.A.result.endedAtMs, players.B.result.endedAtMs);
  return {
    durationMs: Math.ceil((matchEndMs + TIMELINE_TAIL_MS) / 1000) * 1000,
    actions: { A: players.A.recorder.actions, B: players.B.recorder.actions },
    results: { A: players.A.result, B: players.B.result },
    wavesClearedAtFrame: [...players.A.engine.testbedWaveClearedAtFrame],
  };
}

//  Le ondate dopo la prima compaiono quando la precedente e' stata eliminata (piu' la pausa
// TESTBED_WAVE_SPAWN_DELAY_MS del motore), ma in un run reale il frame esatto dell'eliminazione
// puo' variare di qualche frame: un invasore colpito da entrambi i giocatori mentre l'eliminazione
// fatta dall'altro e' ancora in viaggio consuma un proiettile, e l'ultimo invasore cade un po' prima
// o un po' dopo. Se l'ondata successiva comparisse esattamente in quel momento, tutta la partita
// successiva si sposterebbe e le schivate registrate non sarebbero piu' valide. Per questo il
// generatore fissa anche un minStartFrame per ogni ondata successiva alla prima: frame di
// eliminazione registrato + pausa del motore + WAVE_START_MARGIN_FRAMES, arrotondato. Piccoli
// anticipi o ritardi dell'eliminazione non cambiano cosi' il frame di comparsa.
const ENGINE_WAVE_DELAY_FRAMES = 60; // TESTBED_WAVE_SPAWN_DELAY_MS (1000 ms) in frame
const WAVE_START_MARGIN_FRAMES = 60;
const WAVE_START_ROUND_FRAMES = 30;

function recordWithStableWaves(bundles, definition) {
  let current = definition;
  for (let pass = 0; pass <= definition.gameConfig.scriptedWaves.length; pass++) {
    const recorded = recordMatch(bundles, current);
    const waves = current.gameConfig.scriptedWaves.map((wave, index) => {
      if (index === 0) return wave;
      const previousClear = recorded.wavesClearedAtFrame[index - 1];
      if (previousClear === undefined || previousClear === null) return wave;
      const earliest = previousClear + ENGINE_WAVE_DELAY_FRAMES + WAVE_START_MARGIN_FRAMES;
      const minStartFrame = Math.ceil(earliest / WAVE_START_ROUND_FRAMES) * WAVE_START_ROUND_FRAMES;
      return { ...wave, minStartFrame: Math.max(wave.minStartFrame, minStartFrame) };
    });
    const changed = waves.some((wave, index) => wave.minStartFrame !== current.gameConfig.scriptedWaves[index].minStartFrame);
    if (!changed) return { definition: current, recorded };
    current = { ...current, gameConfig: { ...current.gameConfig, scriptedWaves: waves } };
  }
  throw new Error(`${definition.scenarioId}: i frame di comparsa delle ondate non si stabilizzano.`);
}

// -------------------------------------------------------------------------------------------
// Scenari
// -------------------------------------------------------------------------------------------
// Tolleranza sul punteggio finale nel controllo di determinismo: un invasore colpito da entrambi i
// giocatori prima che l'eliminazione arrivi all'altro client vale 100 punti a tutti e due, e quante
// volte succede dipende dalla latenza reale (vedi verify-determinism.mjs, controllo di robustezza).
const SCORE_TOLERANCE = 300;

const DISABLED_RANDOM_SPAWNER = {
  // Spawner casuale disattivato di fatto (intervallo enorme): tutte le ondate arrivano da
  // "scriptedWaves", non dallo spawner casuale.
  gridSpawnIntervalFramesMin: 999999,
  gridSpawnIntervalFramesMax: 999999,
  gridColumnsMin: 2,
  gridColumnsMax: 4,
  gridRowsMin: 1,
  gridRowsMax: 2,
  asteroidSpawnIntervalFramesMin: 999999,
  asteroidSpawnIntervalFramesMax: 999999,
  asteroidsEnabled: false,
};

// Parametri dei due bot: stesse capacita', comportamenti diversi (direzione iniziale, colpi della
// fase libera, lato della formazione da cui iniziano a colpire, cadenza di tiro). I margini sono
// la distanza minima (px) che il bot cerca di tenere da proiettili nemici, asteroidi e invasori:
// assorbono le piccole differenze di un run reale (latenza, timer del browser).
//  Parametri opzionali per rendere un bot volutamente imperfetto:
// - ignoreAsteroidsOfWaves: indici delle ondate il cui asteroide non viene schivato;
// - ignoreProjectiles: true per non schivare i proiettili nemici.
const BOT_A = {
  startDir: "left",
  freeRoamShotsAtMs: [500, 2600, 4700, 6800, 8600],
  side: "left",
  shootIntervalMs: 210,
  projectileMarginPx: 16,
  asteroidMarginPx: 22,
  invaderMarginPx: 12,
};
const BOT_B = {
  startDir: "right",
  freeRoamShotsAtMs: [700, 2800, 4900, 7000, 8800],
  side: "right",
  shootIntervalMs: 220,
  projectileMarginPx: 16,
  asteroidMarginPx: 22,
  invaderMarginPx: 12,
};

// -------------------------------------------------------------------------------------------
// SCENARIO 1 - 10 s di movimento libero, poi ondata 4x7 che non spara, poi due righe da 10 alieni
// che sparano (la seconda compare solo dopo l'eliminazione completa della prima). Nessun asteroide.
// I due bot schivano tutto: sopravvivono entrambi e l'esito si decide a punti.
// -------------------------------------------------------------------------------------------
const SCENARIO_1 = {
  scenarioId: "scenario-1",
  description:
    "10s di movimento libero senza nemici, poi un'ondata di 4x7 alieni che NON sparano, poi una riga di 10 alieni che spara e infine una seconda riga di 10 alieni che spara (ogni ondata compare dopo l'eliminazione completa della precedente). Partita 1v1 con una vita per giocatore e nessun timer: entrambi i giocatori schivano i colpi, sopravvivono e l'esito si decide a punti.",
  seed: 4242,
  room: "room-test-1",
  durationToleranceMs: 600,
  scoreTolerance: SCORE_TOLERANCE,
  gameConfig: {
    ...DISABLED_RANDOM_SPAWNER,
    scriptedWaves: [
      // Fase 2: non prima del frame 600 (10 s a 60 fps) - 4 righe x 7 colonne, non sparano.
      { minStartFrame: 600, columns: 7, rows: 4, canShoot: false },
      // Fase 3: dopo l'eliminazione completa della fase 2 - riga singola di 10 alieni, sparano.
      { minStartFrame: 0, columns: 10, rows: 1, canShoot: true },
      // Fase 4: dopo l'eliminazione completa della fase 3 - uguale alla fase 3.
      { minStartFrame: 0, columns: 10, rows: 1, canShoot: true },
    ],
  },
  bots: { A: BOT_A, B: BOT_B },
};

// -------------------------------------------------------------------------------------------
// SCENARIO 2 - Stesso schema di scenario-1, con un asteroide aggiuntivo in ciascuna fase (fase 1 a
// t = 5 s tramite "scriptedAsteroids", le altre al momento della comparsa della rispettiva ondata
// tramite "spawnAsteroid: true"). Il bot B non schiva l'asteroide che accompagna la prima riga che
// spara e viene eliminato: A continua da solo, elimina le ultime ondate e vince perche' e' l'unico
// sopravvissuto.
// -------------------------------------------------------------------------------------------
const SCENARIO_2 = {
  scenarioId: "scenario-2",
  description:
    "Come scenario-1 (10s movimento libero, poi ondata 4x7 alieni che non sparano, poi due righe da 10 alieni che sparano, una dopo l'altra) ma con un asteroide aggiuntivo in ciascuna delle quattro fasi (a t=5s nella fase libera e alla comparsa di ciascuna ondata). Partita 1v1 con una vita per giocatore e nessun timer: il giocatore B non schiva l'asteroide della prima riga che spara e viene eliminato, il giocatore A continua da solo fino all'ultima ondata.",
  seed: 6200,
  room: "room-test-2",
  durationToleranceMs: 600,
  scoreTolerance: SCORE_TOLERANCE,
  gameConfig: {
    ...DISABLED_RANDOM_SPAWNER,
    scriptedWaves: [
      { minStartFrame: 600, columns: 7, rows: 4, canShoot: false, spawnAsteroid: true },
      { minStartFrame: 0, columns: 10, rows: 1, canShoot: true, spawnAsteroid: true },
      { minStartFrame: 0, columns: 10, rows: 1, canShoot: true, spawnAsteroid: true },
    ],
    // Asteroide della fase 1 (nessuna ondata a cui agganciarlo): frame 300 = 5 s.
    scriptedAsteroids: [{ minStartFrame: 300 }],
  },
  bots: { A: BOT_A, B: { ...BOT_B, ignoreAsteroidsOfWaves: [1] } },
};

function describe(result) {
  const eliminated = result.localEliminated ? `eliminato al frame ${result.localEliminatedAtFrame}` : "sopravvissuto";
  return `${result.outcome} (${result.decidedBy}), punti ${result.localScore}, ${eliminated}`;
}

async function main() {
  const outDir = resolveOutDir();
  fs.mkdirSync(outDir, { recursive: true });
  const bundles = await buildSimulationBundles({ includeEngine: true });

  for (const baseDefinition of [SCENARIO_1, SCENARIO_2]) {
    const { definition, recorded } = recordWithStableWaves(bundles, baseDefinition);
    const scenario = {
      scenarioId: definition.scenarioId,
      description: definition.description,
      seed: definition.seed,
      durationMs: recorded.durationMs,
      room: definition.room,
      durationToleranceMs: definition.durationToleranceMs,
      scoreTolerance: definition.scoreTolerance,
      gameConfig: definition.gameConfig,
      players: {
        A: { actions: recorded.actions.A },
        B: { actions: recorded.actions.B },
      },
      expected: {},
    };

    // Controllo: la timeline registrata, riprodotta da ScenarioPlayer nel simulatore, deve
    // produrre la stessa identica partita.
    const replay = runOneMatch({ ...bundles, scenario, latencyMs: 0 });
    for (const id of ["A", "B"]) {
      const original = recorded.results[id];
      const replayed = replay[id];
      const same =
        original.localScore === replayed.finalScore &&
        original.localEliminated === !replayed.survived &&
        original.outcome === replayed.outcome &&
        original.endFrame === replayed.endFrame &&
        original.finalPositionX === replayed.finalPositionX &&
        original.finalPositionY === replayed.finalPositionY;
      if (!same) {
        throw new Error(
          `${definition.scenarioId}, player ${id}: la riproduzione della timeline non coincide con la partita registrata ` +
            `(${JSON.stringify(original)} / ${JSON.stringify(replayed)}).`,
        );
      }
    }

    const outPath = path.join(outDir, `${scenario.scenarioId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(scenario, null, 2) + "\n");
    console.log(
      `Scritto ${outPath} (timeline ${scenario.durationMs} ms, azioni A=${recorded.actions.A.length} B=${recorded.actions.B.length})\n` +
        `  A: ${describe(recorded.results.A)}\n  B: ${describe(recorded.results.B)}`,
    );
  }
}

// Eseguito come comando (e non importato da un altro script): genera i file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { recordMatch, recordWithStableWaves, SCENARIO_1, SCENARIO_2, BOT_A, BOT_B };
