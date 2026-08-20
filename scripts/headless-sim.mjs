#!/usr/bin/env node
// Simulatore headless deterministico del motore di gioco reale (game/localGame/), usato per:
//  1) calcolare i risultati ATTESI di un giocatore per uno scenario (finalScore, survived,
//     posizione finale, durata) - vedi scripts/verify-determinism.mjs, che li scrive nel campo
//     "expected" del file scenario (src/testbed/scenario.types.ts);
//  2) verificare che lo stesso scenario/seed produca SEMPRE lo stesso risultato bit-per-bit
//     (determinismo, FASE 7 della tesi) eseguendo N ripetizioni indipendenti e confrontandole.
//
//  NON e' una riscrittura del motore di gioco: bundlizza (con esbuild, gia' una dipendenza di
// Vite, quindi gia' presente in node_modules senza bisogno di installare nulla) e poi ESEGUE il
// codice REALE di src/game/localGame/ e src/testbed/scenarioPlayer.ts, dentro un Node "headless"
// con stub minimi di DOM/canvas/timer e un orologio VIRTUALE (non wall-clock): questo elimina alla
// radice il jitter di setTimeout/requestAnimationFrame di un browser reale (vedi il limite onesto
// documentato in scenarioPlayer.ts) e rende il riferimento calcolato qui riproducibile al 100%,
// utile proprio per distinguere "jitter di rete/browser" da "differenza di gameplay" (FASE 7).
//
//  Uso:
//    node scripts/headless-sim.mjs --scenario <path-scenario.json> --player A|B
//    node scripts/headless-sim.mjs --scenario <path-scenario.json> --player A --repeat 5
//
//  Con --repeat N esegue N simulazioni INDIPENDENTI (stesso processo, ma ogni volta ricostruendo
// da zero motore/RNG/orologio - nessuno stato condiviso tra una ripetizione e l'altra) e stampa se
// tutte producono lo stesso risultato bit-per-bit.
//
//  Output: un oggetto JSON su stdout (vedi "printResult" in fondo al file).

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

//  I due testbed hanno una struttura di cartelle leggermente diversa (TS/frontend per il testbed
// MoQ, frontend per quello WebRTC - un dettaglio storico del progetto MoQ, vedi TESTBED.md): questo
// script e' mantenuto byte-per-byte identico tra i due (come generate-scenario.mjs/run-batch.ps1)
// e si adatta da solo rilevando quale delle due esiste, invece di richiedere due copie divergenti.
function resolveFrontendDir() {
  const candidates = [path.join(projectRoot, "TS", "frontend"), path.join(projectRoot, "frontend")];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src", "game", "localGame", "index.ts"))) return candidate;
  }
  throw new Error(`Impossibile trovare la cartella frontend (provati: ${candidates.join(", ")})`);
}

const frontendDir = resolveFrontendDir();
const srcDir = path.join(frontendDir, "src");

async function loadEsbuild() {
  const esbuildMain = path.join(frontendDir, "node_modules", "esbuild", "lib", "main.js");
  if (!fs.existsSync(esbuildMain)) {
    throw new Error(
      `esbuild non trovato in ${esbuildMain}. E' una dipendenza transitiva di Vite: esegui "npm install" in ${frontendDir} se manca.`,
    );
  }
  const mod = await import(pathToFileURL(esbuildMain).href);
  return mod.default ?? mod;
}

//  Bundlizza un entrypoint TS reale del progetto in un singolo file CJS in-memory, cosi' possiamo
// "require()"-arlo subito dopo in questo stesso processo Node. Nessuna riscrittura: e' lo stesso
// identico codice sorgente che gira nel browser, solo compilato per girare fuori da un browser.
async function bundleToCjs(esbuild, entryRelativeToSrc) {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, entryRelativeToSrc)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    target: "node18",
    loader: { ".png": "dataurl" },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

//  Scrive il bundle su un file temporaneo e lo richiede con require() CJS nativo di Node: piu'
// semplice e robusto che valutarlo manualmente con vm/eval (require() gestisce da solo
// module/exports/il caching, e ripulisce gli errori di sintassi con uno stack trace leggibile).
function requireBundle(code, tmpName) {
  const tmpDir = path.join(__dirname, ".headless-sim-tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${tmpName}-${process.pid}-${Date.now()}.cjs`);
  fs.writeFileSync(tmpPath, code);
  try {
    // Nome file univoco (pid + timestamp, vedi sopra) => nessun problema di cache tra chiamate.
    const mod = createRequire(tmpPath)(tmpPath);
    return mod;
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// RNG deterministico (mulberry32) - copia ESATTA dell'algoritmo in src/testbed/rng.ts, verificata
// con "diff" concettuale riga per riga: stesso seed => stessa sequenza qui e nel browser.
// ---------------------------------------------------------------------------------------------
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

function pngSizeFromDataUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const buf = Buffer.from(base64, "base64");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------------------------
// Orologio virtuale + stub DOM minimi. Isolati per-simulazione (nessuno stato di modulo condiviso
// tra due chiamate a runOneSimulation(), vedi la funzione: ogni cosa qui sotto vive dentro di essa).
// ---------------------------------------------------------------------------------------------
const FRAME_MS = 1000 / 60;

function runOneSimulation({ gameBundleCode, scenarioBundleCode, seed, durationMs, actions, gameConfig }) {
  let virtualNow = 0;
  let nextTimerId = 1;
  const timers = new Map(); // id -> { time, fn, intervalMs }
  let pendingRaf = null; // { id, fn }
  let rafSeq = 0;
  const pendingImages = [];

  function setTimeoutStub(fn, delay = 0) {
    const id = nextTimerId++;
    timers.set(id, { time: virtualNow + Math.max(0, delay), fn, intervalMs: null });
    return id;
  }
  function clearTimeoutStub(id) {
    timers.delete(id);
  }
  function setIntervalStub(fn, delay = 0) {
    const id = nextTimerId++;
    const intervalMs = Math.max(1, delay);
    timers.set(id, { time: virtualNow + intervalMs, fn, intervalMs });
    return id;
  }
  function clearIntervalStub(id) {
    timers.delete(id);
  }
  function requestAnimationFrameStub(fn) {
    const id = ++rafSeq;
    pendingRaf = { id, fn };
    return id;
  }
  function cancelAnimationFrameStub(id) {
    if (pendingRaf && pendingRaf.id === id) pendingRaf = null;
  }
  function performanceNow() {
    return virtualNow;
  }

  function drainDueTimers() {
    for (;;) {
      let earliestId = null;
      let earliestTime = Infinity;
      for (const [id, t] of timers) {
        if (t.time <= virtualNow && t.time < earliestTime) {
          earliestTime = t.time;
          earliestId = id;
        }
      }
      if (earliestId === null) break;
      const t = timers.get(earliestId);
      if (t.intervalMs != null) {
        t.time += t.intervalMs;
      } else {
        timers.delete(earliestId);
      }
      t.fn();
    }
  }

  function flushImageLoads() {
    while (pendingImages.length) {
      const img = pendingImages.shift();
      if (img._loaded) continue;
      img.width = img._pendingSize.width;
      img.height = img._pendingSize.height;
      img.complete = true;
      img._loaded = true;
      if (typeof img.onload === "function") img.onload();
    }
  }

  function stepFrame() {
    virtualNow += FRAME_MS;
    drainDueTimers();
    if (pendingRaf) {
      const cb = pendingRaf.fn;
      pendingRaf = null;
      cb(virtualNow);
    }
  }

  class KeyboardEventStub {
    constructor(type, opts = {}) {
      this.type = type;
      this.key = opts.key;
      this.bubbles = !!opts.bubbles;
    }
  }

  class ImageStub {
    constructor() {
      this._src = "";
      this.width = 0;
      this.height = 0;
      this.onload = null;
      this.complete = false;
      this._loaded = false;
      this._pendingSize = { width: 1, height: 1 };
    }
    set src(value) {
      this._src = value;
      this._pendingSize = pngSizeFromDataUrl(value);
      pendingImages.push(this);
    }
    get src() {
      return this._src;
    }
  }

  function createCanvasContextStub() {
    const store = {};
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop in store) return store[prop];
          if (prop === "canvas") return canvasStub;
          return function noop() {};
        },
        set(_target, prop, value) {
          store[prop] = value;
          return true;
        },
      },
    );
  }

  const ctxStub = createCanvasContextStub();
  const canvasStub = {
    width: 1024,
    height: 576,
    getContext: () => ctxStub,
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 576, right: 1024, bottom: 576 }),
  };

  const eventListeners = new Map(); // type -> Set<fn>
  function addEventListenerStub(type, fn) {
    if (!eventListeners.has(type)) eventListeners.set(type, new Set());
    eventListeners.get(type).add(fn);
  }
  function removeEventListenerStub(type, fn) {
    eventListeners.get(type)?.delete(fn);
  }
  function dispatchEventStub(evt) {
    for (const fn of [...(eventListeners.get(evt.type) ?? [])]) fn(evt);
    return true;
  }

  const windowStub = {
    addEventListener: addEventListenerStub,
    removeEventListener: removeEventListenerStub,
    dispatchEvent: dispatchEventStub,
    setTimeout: setTimeoutStub,
    clearTimeout: clearTimeoutStub,
    setInterval: setIntervalStub,
    clearInterval: clearIntervalStub,
    location: { search: "" },
  };

  const documentStub = {
    querySelector: () => null,
    createElement: () => ({ style: {}, addEventListener: () => {}, appendChild: () => {}, remove: () => {} }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, innerHTML: "" },
  };

  // Installo gli stub nel realm globale di QUESTO processo Node (ogni simulazione gira in un
  // processo/chiamata isolata dal chiamante - vedi verify-determinism.mjs - quindi non c'e' rischio
  // di stato condiviso tra ripetizioni: ogni runOneSimulation() li riassegna da zero).
  globalThis.window = windowStub;
  globalThis.document = documentStub;
  globalThis.performance = { now: performanceNow };
  globalThis.setTimeout = setTimeoutStub;
  globalThis.clearTimeout = clearTimeoutStub;
  globalThis.setInterval = setIntervalStub;
  globalThis.clearInterval = clearIntervalStub;
  globalThis.requestAnimationFrame = requestAnimationFrameStub;
  globalThis.cancelAnimationFrame = cancelAnimationFrameStub;
  globalThis.Image = ImageStub;
  globalThis.KeyboardEvent = KeyboardEventStub;
  globalThis.addEventListener = addEventListenerStub;
  globalThis.removeEventListener = removeEventListenerStub;
  globalThis.dispatchEvent = dispatchEventStub;

  // RNG seedato - DEVE succedere prima di richiedere/costruire il motore di gioco, esattamente
  // come installDeterministicRandom(seed) in src/testbed/rng.ts viene chiamato prima di "new
  // LocalGameEngine" in main.ts.
  Math.random = mulberry32(seed);

  const gameModule = requireBundle(gameBundleCode, "game-bundle");
  const scenarioModule = requireBundle(scenarioBundleCode, "scenario-bundle");

  let lastSnapshot = null;
  let finalResult = null;

  const destroy = gameModule.createLocalGame(
    canvasStub,
    (snapshot) => {
      lastSnapshot = snapshot;
    },
    undefined,
    gameConfig,
  );
  flushImageLoads();

  const player = new scenarioModule.ScenarioPlayer({ seed, durationMs, actions });
  player.start(() => {
    finalResult = {
      finalScore: lastSnapshot?.score ?? 0,
      survived: !(lastSnapshot?.gameOver ?? false),
      finalPositionX: lastSnapshot?.player?.x ?? 0,
      finalPositionY: lastSnapshot?.player?.y ?? 0,
      actualDurationMs: virtualNow,
    };
  });

  const HARD_STOP_MS = durationMs + 2000; // margine di sicurezza oltre la fine scenario (vedi commento sopra su HARD_STOP)
  while (finalResult === null && virtualNow < HARD_STOP_MS) {
    stepFrame();
    flushImageLoads();
  }

  destroy();

  if (finalResult === null) {
    throw new Error(
      "La simulazione non ha raggiunto la fine dello scenario entro il margine di sicurezza: controllare durationMs/azioni.",
    );
  }

  return finalResult;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { repeat: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scenario") args.scenario = argv[++i];
    else if (argv[i] === "--player") args.player = argv[++i];
    else if (argv[i] === "--repeat") args.repeat = Number(argv[++i]);
  }
  if (!args.scenario || !args.player) {
    throw new Error("Uso: node scripts/headless-sim.mjs --scenario <path.json> --player A|B [--repeat N]");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarioPath = path.resolve(args.scenario);
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  const playerActions = scenario.players?.[args.player]?.actions;
  if (!playerActions) {
    throw new Error(`Lo scenario "${scenarioPath}" non ha azioni per il player "${args.player}".`);
  }

  const esbuild = await loadEsbuild();
  const gameBundleCode = await bundleToCjs(esbuild, path.join("game", "localGame", "index.ts"));
  const scenarioBundleCode = await bundleToCjs(esbuild, path.join("testbed", "scenarioPlayer.ts"));

  const results = [];
  for (let i = 0; i < args.repeat; i++) {
    const result = runOneSimulation({
      gameBundleCode,
      scenarioBundleCode,
      seed: scenario.seed,
      durationMs: scenario.durationMs,
      actions: playerActions,
      gameConfig: scenario.gameConfig,
    });
    results.push(result);
  }

  const first = results[0];
  const allIdentical = results.every(
    (r) =>
      r.finalScore === first.finalScore &&
      r.survived === first.survived &&
      r.finalPositionX === first.finalPositionX &&
      r.finalPositionY === first.finalPositionY &&
      r.actualDurationMs === first.actualDurationMs,
  );

  const output = {
    scenarioId: scenario.scenarioId ?? path.basename(scenarioPath),
    player: args.player,
    seed: scenario.seed,
    repeat: args.repeat,
    deterministicAcrossRepeats: allIdentical,
    result: first,
    allResults: args.repeat > 1 ? results : undefined,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  if (!allIdentical) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
