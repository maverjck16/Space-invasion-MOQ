// Genera i 2 file di scenario deterministico (scenario-1.json, scenario-2.json) usati dal
// testbed al posto del controllo manuale da tastiera (vedi frontend/src/testbed/scenarioPlayer.ts
// e frontend/src/testbed/scenario.types.ts per lo schema).
//
//  Ogni scenario contiene DUE timeline di input indipendenti (players.A / players.B): stesso seed
// RNG (quindi stesso "mondo") ma azioni diverse, cosi' i due giocatori automatici si muovono/
// sparano in modo diverso e ottengono punteggi diversi pur restando entrambi completamente
// deterministici - vedi il commento in scenario.types.ts sul perche' il seed e' condiviso. Il
// campo "expected" viene lasciato vuoto qui: e' scripts/verify-determinism.mjs (che usa il
// simulatore headless reale, scripts/headless-sim.mjs) a calcolarlo e scriverlo, cosi' il valore
// atteso e' sempre generato eseguendo DAVVERO il motore di gioco, mai a mano.
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
//  Storico: la versione precedente di questo script generava scenario-1/scenario-2 con
// buildRealisticActions() (sweep + raffiche brevi + beccheggio verticale periodico, per uno stile
// "partita giocata da una persona"), MA senza alcun controllo sul numero/composizione delle
// ondate di alieni (spawner casuale): il risultato durava troppo poco e non garantiva ne' un
// numero ne' un ordine preciso di ondate. Questa versione usa invece il nuovo meccanismo
// "scriptedWaves"/"scriptedAsteroids" (vedi game/localGame/types.ts e LocalGameEngine.animate())
// per COSTRUIRE ESATTAMENTE lo schema richiesto: 10s di movimento libero, poi un'ondata di alieni
// 4 righe x 7 colonne che NON sparano (deve essere distrutta per intero), poi una riga di 10
// alieni che sparano - identico per i due scenari, con la sola differenza che scenario-2 aggiunge
// un asteroide extra in ciascuna delle tre fasi (scenario-1 resta senza asteroidi, come da
// richiesta "1 no asteroidi/asteroidi solo nel 2").

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(__dirname);

function resolveOutDir() {
  const candidates = [path.join(projectRoot, "TS", "frontend", "public"), path.join(projectRoot, "frontend", "public")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.join(candidate, "scenarios");
  }
  throw new Error(`Impossibile trovare la cartella public/ (provati: ${candidates.join(", ")})`);
}

const CANVAS_WIDTH = 1024;
// Larghezza REALE dello sprite del giocatore dopo il caricamento dell'immagine (450px * scala 0.18,
// vedi entities/Player.ts): usata solo per tenere le traiettorie generate dentro lo schermo, non
// influisce sul determinismo (il motore di gioco calcola da solo i propri limiti).
const PLAYER_WIDTH = 81;
const PLAYER_SPEED_PX_PER_MS = (7 * 60) / 1000; // velocita' orizzontale del giocatore nel motore di gioco

let idCounter = 1;
function makeAction(timeMs, type, extra = {}) {
  const prefix = type === "shoot" ? "shot" : "input";
  return { id: `${prefix}_${String(idCounter++).padStart(4, "0")}`, timeMs, type, ...extra };
}

// -------------------------------------------------------------------------------------------
// FASE 1 (0 - PHASE1_END ms): "per 10s la navicella si muove a sinistra a destra in alto e in
// basso e spara qualche colpo" - nessun nemico a schermo (le ondate scriptate iniziano dopo,
// vedi scriptedWaves.minStartFrame). Movimento libero su entrambi gli assi + qualche colpo sparso
// (non un pattern di "pulizia" ad alta cadenza, qui non ci sono ancora invasori da colpire).
// -------------------------------------------------------------------------------------------
function buildFreeRoamActions({ endMs, shotsAtMs, startDir = "left" }) {
  const actions = [];
  const push = (t, type, extra) => actions.push(makeAction(t, type, extra));
  push(0, "moveX", { dir: startDir });
  push(1600, "moveX", { dir: startDir === "left" ? "right" : "left" });
  push(3200, "moveY", { dir: "down" });
  push(3500, "moveY", { dir: "none" });
  push(3600, "moveX", { dir: startDir });
  push(5200, "moveX", { dir: startDir === "left" ? "right" : "left" });
  push(6800, "moveY", { dir: "up" });
  push(7100, "moveY", { dir: "none" });
  push(7200, "moveX", { dir: startDir });
  push(endMs - 400, "moveX", { dir: "none" });
  for (const t of shotsAtMs) push(t, "shoot");
  return actions;
}

// -------------------------------------------------------------------------------------------
// FASE 2+3 (da PHASE1_END fino alla fine): sweep continuo su tutta la larghezza dello schermo +
// sparo a cadenza regolare - usato per "ripulire" le ondate scriptate (la griglia 4x7 che non
// spara nella fase 2, poi la riga di 10 che spara nella fase 3). Stesso stile di
// buildStressActions delle versioni precedenti di questo script, ma qui e' l'unico movimento
// orizzontale delle fasi 2/3 (non e' un semplice "sweep di sottofondo": e' quello che garantisce
// di intercettare/colpire OGNI colonna della griglia, requisito esplicito "la navicella deve
// distruggerli tutti").
// -------------------------------------------------------------------------------------------
function buildClearActions({ startMs, endMs, legMs, shootIntervalMs, startDir = "left" }) {
  const actions = [];
  const push = (t, type, extra) => actions.push(makeAction(t, type, extra));
  let dir = startDir;
  let x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
  let t = startMs;
  let nextShoot = startMs + 30;
  const movementEndMs = endMs - 300;
  while (t < movementEndMs) {
    push(t, "moveX", { dir });
    while (nextShoot <= t + legMs && nextShoot < movementEndMs) {
      push(nextShoot, "shoot");
      nextShoot += shootIntervalMs;
    }
    const delta = (dir === "right" ? 1 : -1) * legMs * PLAYER_SPEED_PX_PER_MS;
    x = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_WIDTH, x + delta));
    if (x <= 4) dir = "right";
    else if (x >= CANVAS_WIDTH - PLAYER_WIDTH - 4) dir = "left";
    t += legMs;
  }
  push(t, "moveX", { dir: "none" });
  return actions;
}

// -------------------------------------------------------------------------------------------
// Scarti verticali di sicurezza (solo scenario-2): subito dopo ogni istante di spawn di un
// asteroide scriptato, il giocatore tiene premuto il tasto verticale per "holdMs" - l'asteroide
// punta esattamente alla posizione del giocatore nell'istante di spawn (vedi Asteroid.ts) e
// prosegue poi in linea retta, quindi allontanarsi subito dopo riduce le probabilita' di essere
// centrati. NON e' una garanzia assoluta (l'asteroide e' comunque un pericolo aggiuntivo VOLUTO
// dalla richiesta "un solo asteroide in ciascuna delle tre fasi": e' accettabile che aumenti il
// rischio, l'obiettivo "la navicella deve distruggerli tutti" riguarda le ondate di alieni, non
// la sopravvivenza garantita agli asteroidi) - i timing/direzioni qui sotto sono stati scelti
// verificando con il simulatore headless che entrambi i giocatori distruggono comunque per
// intero entrambe le ondate scriptate.
// -------------------------------------------------------------------------------------------
function buildAsteroidDodges(spec) {
  const actions = [];
  for (const { t, dir, holdMs } of spec) {
    actions.push(makeAction(t + 40, "moveY", { dir }));
    actions.push(makeAction(t + 40 + holdMs, "moveY", { dir: "none" }));
  }
  return actions;
}

// Assembla la timeline completa di un giocatore (uno o piu' "pezzi" concatenati - free-roam,
// clear, eventuali scarti anti-asteroide) azzerando idCounter PRIMA di costruirli, cosi' gli id
// restano leggibili/sequenziali (input_0001, shot_0001, ...) per ogni singolo giocatore invece di
// continuare a incrementarsi tra scenari/giocatori diversi.
function buildPlayerActions(builders) {
  idCounter = 1;
  const actions = builders.flatMap((build) => build());
  actions.sort((a, b) => a.timeMs - b.timeMs);
  return actions;
}

const PHASE1_END = 10000;

// -------------------------------------------------------------------------------------------
// SCENARIO 1 - "per 10s la navicella si muove a sinistra a destra in alto e in basso e spara
// qualche colpo, per altri 20s circa compaiono griglie di alieni formate da 4 righe per 7 alieni
// l'una CHE NON SPARANO COLPI e la navicella deve distruggerli tutti, poi comparira' una sola
// riga di 10 alieni che sparera' dei colpi" - nessun asteroide in questo scenario.
// -------------------------------------------------------------------------------------------
const SCENARIO_1_DURATION_MS = 48000;
const SCENARIO_1 = {
  scenarioId: "scenario-1",
  description:
    "10s di movimento libero senza nemici, poi un'ondata di 4x7 alieni che NON sparano (la navicella deve distruggerli tutti), infine una riga di 10 alieni che spara.",
  seed: 4242,
  durationMs: SCENARIO_1_DURATION_MS,
  room: "room-test-1",
  durationToleranceMs: 600,
  gameConfig: {
    // Spawner casuale disattivato di fatto (intervallo enorme): tutte le ondate arrivano da
    // "scriptedWaves" qui sotto, non dallo spawner casuale.
    gridSpawnIntervalFramesMin: 999999,
    gridSpawnIntervalFramesMax: 999999,
    gridColumnsMin: 2,
    gridColumnsMax: 4,
    gridRowsMin: 1,
    gridRowsMax: 2,
    asteroidSpawnIntervalFramesMin: 999999,
    asteroidSpawnIntervalFramesMax: 999999,
    asteroidsEnabled: false,
    scriptedWaves: [
      // Fase 2: appare non prima del frame 600 (10s a 60fps) - 4 righe x 7 colonne, non sparano.
      { minStartFrame: 600, columns: 7, rows: 4, canShoot: false },
      // Fase 3: appare appena la fase 2 e' stata distrutta per intero (minStartFrame: 0, la vera
      // condizione di attesa e' "nessuna griglia viva", vedi LocalGameEngine.animate()) - riga
      // singola di 10 alieni, sparano.
      { minStartFrame: 0, columns: 10, rows: 1, canShoot: true },
    ],
  },
  players: {
    A: {
      actions: buildPlayerActions([
        () => buildFreeRoamActions({ endMs: PHASE1_END, shotsAtMs: [500, 2600, 4700, 6800, 8600], startDir: "left" }),
        () => buildClearActions({ startMs: PHASE1_END, endMs: SCENARIO_1_DURATION_MS, legMs: 200, shootIntervalMs: 180, startDir: "left" }),
      ]),
    },
    B: {
      actions: buildPlayerActions([
        () => buildFreeRoamActions({ endMs: PHASE1_END, shotsAtMs: [700, 2800, 4900, 7000, 8800], startDir: "right" }),
        () => buildClearActions({ startMs: PHASE1_END, endMs: SCENARIO_1_DURATION_MS, legMs: 200, shootIntervalMs: 180, startDir: "right" }),
      ]),
    },
  },
  expected: {},
};

// -------------------------------------------------------------------------------------------
// SCENARIO 2 - Stesso schema di scenario-1 (10s movimento libero, poi ondata 4x7 che non spara,
// poi riga di 10 che spara), ma con un asteroide aggiuntivo in ciascuna delle tre fasi (fase 1 a
// t=5s tramite "scriptedAsteroids", fase 2 e fase 3 al momento dello spawn della rispettiva
// ondata tramite "spawnAsteroid: true" sulla ScriptedWave corrispondente).
// -------------------------------------------------------------------------------------------
const SCENARIO_2_DURATION_MS = 50000;
const SCENARIO_2 = {
  scenarioId: "scenario-2",
  description:
    "Come scenario-1 (10s movimento libero, poi ondata 4x7 alieni che non sparano, poi riga di 10 alieni che spara) ma con un asteroide aggiuntivo in ciascuna delle tre fasi (fase 1, fase 2 e fase 3, al momento dello spawn di ciascuna).",
  seed: 6200,
  durationMs: SCENARIO_2_DURATION_MS,
  room: "room-test-2",
  durationToleranceMs: 600,
  gameConfig: {
    gridSpawnIntervalFramesMin: 999999,
    gridSpawnIntervalFramesMax: 999999,
    gridColumnsMin: 2,
    gridColumnsMax: 4,
    gridRowsMin: 1,
    gridRowsMax: 2,
    asteroidSpawnIntervalFramesMin: 999999,
    asteroidSpawnIntervalFramesMax: 999999,
    asteroidsEnabled: false,
    scriptedWaves: [
      { minStartFrame: 600, columns: 7, rows: 4, canShoot: false, spawnAsteroid: true },
      { minStartFrame: 0, columns: 10, rows: 1, canShoot: true, spawnAsteroid: true },
    ],
    // Asteroide della fase 1 (nessuna ondata a cui agganciarlo): frame 300 = 5s.
    scriptedAsteroids: [{ minStartFrame: 300 }],
  },
  players: {
    A: {
      actions: buildPlayerActions([
        () => buildFreeRoamActions({ endMs: PHASE1_END, shotsAtMs: [500, 2600, 4700, 6800, 8600], startDir: "left" }),
        () => buildClearActions({ startMs: PHASE1_END, endMs: SCENARIO_2_DURATION_MS, legMs: 200, shootIntervalMs: 180, startDir: "left" }),
        // Scarti verificati con il simulatore headless: asteroide fase1 (spawn t~5s), asteroide
        // fase2 (spawn esatto t=10s, appena la ondata 4x7 compare), asteroide fase3 (spawn quando
        // la riga da 10 compare, ~t=39.9s per questo giocatore/seed - vedi verify-determinism per
        // il valore "expected" gia' calcolato).
        () => buildAsteroidDodges([
          { t: 5000, dir: "up", holdMs: 800 },
          { t: 10000, dir: "down", holdMs: 300 },
          { t: 39883, dir: "down", holdMs: 400 },
        ]),
      ]),
    },
    B: {
      actions: buildPlayerActions([
        () => buildFreeRoamActions({ endMs: PHASE1_END, shotsAtMs: [700, 2800, 4900, 7000, 8800], startDir: "right" }),
        () => buildClearActions({ startMs: PHASE1_END, endMs: SCENARIO_2_DURATION_MS, legMs: 200, shootIntervalMs: 180, startDir: "right" }),
        () => buildAsteroidDodges([
          { t: 5000, dir: "up", holdMs: 800 },
          { t: 10000, dir: "down", holdMs: 300 },
          { t: 36850, dir: "down", holdMs: 700 },
        ]),
      ]),
    },
  },
  expected: {},
};

const outDir = resolveOutDir();
fs.mkdirSync(outDir, { recursive: true });

for (const scenario of [SCENARIO_1, SCENARIO_2]) {
  const outPath = path.join(outDir, `${scenario.scenarioId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(scenario, null, 2) + "\n");
  console.log(`Scritto ${outPath}`);
}
