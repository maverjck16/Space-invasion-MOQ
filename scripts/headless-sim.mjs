// Simulatore headless di UNA partita 1v1 del testbed, usato da verify-determinism.mjs per calcolare
// (e verificare la riproducibilita' del) risultato ATTESO di ciascuno scenario.
//
// 1v1 - server autoritativo: prima di questa modifica, il testbed non aveva un server e ogni
// "partita di riferimento" veniva calcolata eseguendo DAVVERO, in due sandbox Node separate (una
// per Player A, una per Player B), il codice TypeScript reale del client (bundlizzato con esbuild
// ed eseguito in un contesto node:vm con stub minimi di canvas/Image/window), perche' l'INTERA
// arena condivisa viveva esclusivamente li' dentro, identica sui due lati solo grazie a un seed
// pseudo-casuale comune (vedi il vecchio testbed/rng.ts, rimosso). Quel doppio bundle+sandbox
// esisteva per un solo motivo: far girare in Node lo stesso motore di gioco del browser.
//
// Ora l'arena condivisa (invasori, asteroidi, proiettili nemici, punteggio, vite, esito) e' gia'
// un modulo Node puro, senza alcuna dipendenza dal browser: arena-server/simulation.js, lo stesso
// file che il vero processo server (arena-server/server.js) esegue in produzione. Non c'e' quindi
// piu' nulla da bundlizzare ne' da eseguire in una sandbox: questo script importa direttamente
// simulation.js e lo fa girare, esattamente come farebbe il server reale, pilotato pero' da un
// orologio virtuale invece che da Date.now()/setInterval per restare riproducibile bit per bit.
//
// L'unica parte che questo script deve ancora riprodurre "a mano" e' la fisica elementare della
// PROPRIA navicella (velocita' costante lungo i tasti premuti, posizione bloccata ai bordi del
// canvas) - vedi entities/Player.ts - perche' il movimento del giocatore resta, per scelta
// architetturale, di competenza del client: il server riceve solo la posizione che il client
// riporta periodicamente (vedi sendArenaState in LocalGameEngine.ts, NETWORK_TICK_HZ in config.ts),
// non simula lui stesso il movimento. Questa fisica e' poche righe (createVirtualPlayer/
// stepVirtualPlayer sotto), quindi reimplementarla direttamente qui e' piu' semplice e piu'
// affidabile di bundlizzare l'intero Player.ts per un calcolo cosi' elementare.
//
// Semplificazione documentata: Player.ts parte da uno sprite 60x60 finche' l'immagine non e'
// caricata (evento "onload" del browser), poi passa a 81x40.5 (spaceship.png 450x225, scala 0.18) e
// ricentra la navicella. In un browser reale questo accade entro il primissimo frame utile, ben
// prima che il timeline di input dello scenario inizi a premere tasti - per questo motivo, e
// perche' scripts/generate-scenario.mjs aveva gia' calcolato le timeline usando le dimensioni
// POST-caricamento, il giocatore virtuale qui sotto usa direttamente 81x40.5 fin dal frame 0 invece
// di modellare un evento di caricamento immagine che non avrebbe alcun ruolo nella fisica.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// Stessa logica di ricerca "prova le due possibili radici" gia' usata da generate-scenario.mjs/
// verify-determinism.mjs per individuare frontend/ (TS/frontend per MoQ, frontend per WebRTC):
// qui cerchiamo invece arena-server/, che vive allo stesso livello di frontend/.
function resolveArenaServerDir() {
  const candidates = [path.join(projectRoot, "arena-server"), path.join(projectRoot, "TS", "arena-server")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "simulation.js"))) return candidate;
  }
  throw new Error(
    `Impossibile trovare arena-server/simulation.js (provati: ${candidates.join(", ")}). ` +
      `Verifica di eseguire questo script dalla radice del progetto (Tesi-WebRTC o Tesi-MoQ).`,
  );
}

const require = createRequire(import.meta.url);
const { createRoom, FRAME_MS, CANVAS_WIDTH, CANVAS_HEIGHT } = require(path.join(resolveArenaServerDir(), "simulation.js"));

export { FRAME_MS };

// ---------------------------------------------------------------------------------------------
// Orologio virtuale: stesso principio gia' usato in arena-server/test/simulation.test.js, qui
// riesposto come modulo condiviso perche' serve anche a questo script (il tempo "reale" non deve
// mai entrare in gioco: ne' per i timer di respawn/invulnerabilita' di simulation.js, ne' per la
// schedulazione degli invii periodici di stato che questo script stesso simula, vedi sotto).
// ---------------------------------------------------------------------------------------------
export function createVirtualClock(startMs = 0) {
  let now = startMs;
  const pending = []; // { id, dueAt, fn }
  let nextId = 1;
  return {
    now: () => now,
    setTimer(fn, delayMs) {
      const id = nextId++;
      pending.push({ id, dueAt: now + Math.max(0, delayMs), fn });
      return id;
    },
    clearTimer(id) {
      const idx = pending.findIndex((t) => t.id === id);
      if (idx !== -1) pending.splice(idx, 1);
    },
    advance(ms) {
      now += ms;
      for (;;) {
        const due = pending.filter((t) => t.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!due) break;
        pending.splice(pending.indexOf(due), 1);
        due.fn();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fisica minima della propria navicella - vedi entities/Player.ts (originale) per il codice da cui
// queste poche righe sono state riprese: velocita' costante quando un tasto direzionale e'
// premuto, nessuna accelerazione, posizione bloccata ai bordi del canvas.
// ---------------------------------------------------------------------------------------------
const PLAYER_SPEED_X = 7;
const PLAYER_SPEED_Y = 3;
const PLAYER_WIDTH = 81; // vedi nota di semplificazione in cima al file
const PLAYER_HEIGHT = 40.5;
const PLAYER_PROJECTILE_SPEED = 10;
const PLAYER_PROJECTILE_RADIUS = 4;
const LOCAL_SPAWN_X_FRACTION = 0.35; // stessa costante di LocalGameEngine.ts
const REMOTE_SPAWN_X_FRACTION = 0.65;
// Frequenza con cui il client reale riporta la propria posizione al server (vedi
// sendArenaState/NETWORK_TICK_HZ in LocalGameEngine.ts/config.ts): il server non vede la
// posizione aggiornata ad ogni frame simulato, solo a questa cadenza - per questo il giocatore
// virtuale qui sotto tiene una posizione "vera" aggiornata ogni frame, ma la riporta alla stanza
// solo a questi intervalli, invece che ad ogni tickOnce().
const NETWORK_TICK_MS = 1000 / 25;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createVirtualPlayer(spawnXFraction) {
  return {
    x: CANVAS_WIDTH * spawnXFraction - PLAYER_WIDTH / 2,
    y: CANVAS_HEIGHT - PLAYER_HEIGHT - 30,
    keys: { left: false, right: false, up: false, down: false },
    shotSeq: 0,
  };
}

// Stessa logica di LocalGameEngine.animate(): velocita' x con priorita' a "sinistra" se entrambi i
// tasti fossero premuti (else-if), velocita' y invece NON e' un else-if nell'originale (l'ultimo
// if vince) - qui e' comunque irrilevante: il dispatcher delle azioni sotto garantisce che ogni
// asse abbia sempre una sola direzione attiva alla volta, mai entrambe.
function stepVirtualPlayer(vp) {
  let vx = 0;
  let vy = 0;
  if (vp.keys.left) vx = -PLAYER_SPEED_X;
  else if (vp.keys.right) vx = PLAYER_SPEED_X;
  if (vp.keys.up) vy = -PLAYER_SPEED_Y;
  if (vp.keys.down) vy = PLAYER_SPEED_Y;

  vp.x = clamp(vp.x + vx, 0, CANVAS_WIDTH - PLAYER_WIDTH);
  vp.y = clamp(vp.y + vy, 0, CANVAS_HEIGHT - PLAYER_HEIGHT);
}

// ---------------------------------------------------------------------------------------------
// Riproduce la modalita' "a frame" di testbed/scenarioPlayer.ts (l'unica usata dagli scenari
// generati: vedi scenario.types.ts/scenarioPlayer.ts) - ad ogni frame invia le azioni previste
// fino a quel frame incluso, nello stesso ordine (a parita' di frame, ordine della timeline: Array
// .prototype.sort di Node e' stabile, come richiesto).
// ---------------------------------------------------------------------------------------------
function createActionDispatcher(actions) {
  const sorted = [...actions].sort((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
  let next = 0;
  return {
    forFrame(frame, vp, onShoot) {
      while (next < sorted.length && (sorted[next].frame ?? 0) <= frame) {
        const action = sorted[next];
        next += 1;
        if (action.type === "moveX") {
          vp.keys.left = action.dir === "left";
          vp.keys.right = action.dir === "right";
        } else if (action.type === "moveY") {
          vp.keys.up = action.dir === "up";
          vp.keys.down = action.dir === "down";
        } else if (action.type === "shoot") {
          onShoot();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Esegue UNA partita 1v1 completa (Player A + Player B nella stessa stanza) usando direttamente
// arena-server/simulation.js, restituendo il risultato dal punto di vista di ciascun giocatore
// nella stessa forma di ScenarioExpectedResult (vedi scenario.types.ts) piu' "actualDurationMs".
//
// "latencyMs" simula un ritardo di rete fisso tra il giocatore virtuale e il server dell'arena
// (applicato sia ai riporti periodici di posizione sia ai colpi sparati): a differenza della
// vecchia architettura P2P, dove la latenza determinava quanto le DUE copie locali dell'arena
// potevano disallinearsi tra loro, qui il server e' l'unica autorita' e la latenza determina solo
// quanto la posizione che usa per le collisioni di un giocatore sia "vecchia" rispetto a dove si
// trova davvero in quel momento - un modello piu' vicino a un vero netcode client-server (vedi
// verify-determinism.mjs per come viene usato per un controllo di robustezza, non di correttezza).
// ---------------------------------------------------------------------------------------------
export function runOneMatch({ scenario, latencyMs = 0 }) {
  const clock = createVirtualClock();
  const room = createRoom({
    matchMode: "testbed",
    gameConfig: scenario.gameConfig,
    seed: scenario.seed,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  const ids = ["A", "B"];
  const usernames = { A: "A", B: "B" };
  const spawnFraction = { A: LOCAL_SPAWN_X_FRACTION, B: REMOTE_SPAWN_X_FRACTION };
  const vplayers = {};
  const dispatchers = {};

  for (const id of ids) {
    room.addPlayer(usernames[id]);
    vplayers[id] = createVirtualPlayer(spawnFraction[id]);
    dispatchers[id] = createActionDispatcher(scenario.players[id].actions);
  }

  function reportState(id) {
    const vp = vplayers[id];
    const payload = { x: vp.x, y: vp.y, width: PLAYER_WIDTH, height: PLAYER_HEIGHT };
    if (latencyMs > 0) clock.setTimer(() => room.setPlayerState(usernames[id], payload), latencyMs);
    else room.setPlayerState(usernames[id], payload);
  }

  function reportFire(id) {
    const vp = vplayers[id];
    vp.shotSeq += 1;
    const shot = {
      id: `shot-${id}-${vp.shotSeq}`,
      x: vp.x + PLAYER_WIDTH / 2,
      y: vp.y - 5,
      vx: 0,
      vy: -PLAYER_PROJECTILE_SPEED,
      radius: PLAYER_PROJECTILE_RADIUS,
    };
    if (latencyMs > 0) clock.setTimer(() => room.fire(usernames[id], shot), latencyMs);
    else room.fire(usernames[id], shot);
  }

  // Il motore locale (qui: il giocatore virtuale) parte esattamente a startAtEpochMs, non al
  // tempo 0 assoluto - stesso margine gia' usato da main.ts/simulation.js (vedi il commento su
  // "started" in simulation.js: da questa modifica in poi tickOnce() e' un no-op fino a questo
  // istante, cosi' il conteggio frame del server e quello del client restano allineati).
  const startAtEpochMs = room.startAtEpochMs();
  let frame = 0;
  let nextNetworkSendAt = startAtEpochMs + NETWORK_TICK_MS;

  // Margine ampio oltre la fine della timeline di input: la partita del testbed non ha un timer
  // (finisce quando entrambi sono eliminati o poco dopo l'ultima ondata, vedi
  // updateTestbedMatchState() in simulation.js), quindi puo' proseguire oltre "durationMs" se i
  // due giocatori sopravvivono piu' a lungo della timeline scriptata.
  const hardStopMs = startAtEpochMs + scenario.durationMs + 180000;

  while (!room.isEnded() && clock.now() < hardStopMs) {
    if (clock.now() >= startAtEpochMs) {
      for (const id of ids) {
        dispatchers[id].forFrame(frame, vplayers[id], () => reportFire(id));
        stepVirtualPlayer(vplayers[id]);
      }
      if (clock.now() >= nextNetworkSendAt) {
        for (const id of ids) reportState(id);
        nextNetworkSendAt += NETWORK_TICK_MS;
      }
      frame += 1;
    }
    room.tickOnce();
    clock.advance(FRAME_MS);
  }

  if (!room.isEnded()) {
    room.destroy();
    throw new Error(
      `Lo scenario "${scenario.scenarioId}" non ha raggiunto un esito entro ${hardStopMs}ms virtuali ` +
        `(timeline di ${scenario.durationMs}ms + margine di 180000ms): controllare le ondate/azioni configurate.`,
    );
  }

  const result = room.getResult();
  // Arrotondato al millesimo di ms: la somma ripetuta di FRAME_MS (1000/60, periodico) accumula un
  // rumore in virgola mobile trascurabile (~1e-9ms) ma esteticamente fastidioso una volta scritto
  // nel file scenario-N.json - irrilevante per qualunque tolleranza reale (durationToleranceMs e'
  // espressa in centinaia di millisecondi).
  const actualDurationMs = Math.round((clock.now() - startAtEpochMs) * 1000) / 1000;
  room.destroy();

  function toPlayerResult(id) {
    const mine = result.players.find((p) => p.username === usernames[id]);
    const other = result.players.find((p) => p.username !== usernames[id]);
    return {
      finalScore: mine.score,
      survived: !mine.eliminated,
      finalPositionX: mine.finalPositionX,
      finalPositionY: mine.finalPositionY,
      actualDurationMs,
      outcome: mine.outcome,
      decidedBy: result.decidedBy,
      endReason: result.endReason,
      opponentScore: other.score,
      eliminatedAtFrame: mine.eliminatedAtFrame,
      lastWaveClearedAtFrame: result.lastWaveClearedAtFrame,
      endFrame: result.endFrame,
    };
  }

  return { A: toPlayerResult("A"), B: toPlayerResult("B") };
}
