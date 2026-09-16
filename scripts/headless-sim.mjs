#!/usr/bin/env node
// Simulatore headless deterministico del motore di gioco reale (game/localGame/), usato per:
//  1) calcolare i risultati ATTESI di un giocatore per uno scenario (punteggio, sopravvivenza,
//     esito della partita, posizione finale, durata) - vedi scripts/verify-determinism.mjs, che li
//     scrive nel campo "expected" del file scenario (src/testbed/scenario.types.ts);
//  2) verificare che lo stesso scenario/seed produca SEMPRE lo stesso risultato bit-per-bit
//     (determinismo, FASE 7 della tesi) eseguendo N ripetizioni indipendenti e confrontandole.
//
//  NON e' una riscrittura del motore di gioco: bundlizza (con esbuild, gia' una dipendenza di
// Vite, quindi gia' presente in node_modules senza bisogno di installare nulla) e poi ESEGUE il
// codice REALE di src/game/localGame/ e src/testbed/scenarioPlayer.ts, dentro Node, con stub
// minimi di DOM/canvas/timer e un orologio VIRTUALE (non wall-clock): questo elimina alla radice il
// jitter di setTimeout di un browser reale (vedi il limite onesto documentato in
// scenarioPlayer.ts) e rende il riferimento calcolato qui riproducibile al 100%.
//
//  TESTBED 1v1: la partita automatica si gioca in due nella stessa arena (una sola vita ciascuno,
// nessun timer, vedi LocalGameEngine.updateTestbedMatchState()), quindi il risultato di un
// giocatore dipende anche dall'altro. Il simulatore esegue percio' DUE client completi (Player A e
// Player B), ciascuno nel proprio contesto isolato (node:vm: proprio Math.random seedato, propri
// listener di tastiera, proprie immagini), che condividono solo l'orologio virtuale e una "rete"
// simulata: gli snapshot di un client arrivano all'altro dopo --latency-ms millisecondi (default 0,
// cioe' rete ideale). Entrambi i client avviano motore e timeline nello stesso istante, come fa
// main.ts quando i due giocatori si vedono nella room, e la simulazione termina quando entrambi
// hanno un esito.
//
//  Uso:
//    node scripts/headless-sim.mjs --scenario <path-scenario.json> --player A|B
//    node scripts/headless-sim.mjs --scenario <path-scenario.json> --player A --repeat 5
//    node scripts/headless-sim.mjs --scenario <path-scenario.json> --player B --latency-ms 40
//
//  Con --repeat N esegue N simulazioni INDIPENDENTI (ogni volta ricostruendo da zero contesti,
// motori, RNG e orologio - nessuno stato condiviso tra una ripetizione e l'altra) e stampa se tutte
// producono lo stesso risultato bit-per-bit.
//
//  Output: un oggetto JSON su stdout (vedi "output" in fondo al file). I log del gioco, se ce ne
// sono, vanno su stderr.

import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

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

//  Bundlizza un entrypoint TS reale del progetto in un unico script IIFE in memoria, che espone i
// suoi export nella variabile globale "globalName" del contesto in cui viene eseguito. Nessuna
// riscrittura: e' lo stesso identico codice sorgente che gira nel browser.
async function bundleToIife(esbuild, entryRelativeToSrc, globalName) {
  const result = await esbuild.build({
    entryPoints: [path.join(srcDir, entryRelativeToSrc)],
    bundle: true,
    write: false,
    format: "iife",
    globalName,
    platform: "browser",
    target: "es2022",
    loader: { ".png": "dataurl" },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

// ---------------------------------------------------------------------------------------------
// RNG deterministico (mulberry32) - copia ESATTA dell'algoritmo in src/testbed/rng.ts: stesso seed
// => stessa sequenza qui e nel browser.
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
// Orologio virtuale condiviso dai due client: setTimeout/setInterval/performance.now() di entrambi
// i contesti passano da qui. I timer scaduti vengono eseguiti in ordine di scadenza (a parita', in
// ordine di creazione), indipendentemente dal client che li ha creati.
// ---------------------------------------------------------------------------------------------
export const FRAME_MS = 1000 / 60;

export function createVirtualClock() {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map(); // id -> { time, fn, intervalMs }

  function drainDueTimers() {
    for (;;) {
      let earliestId = null;
      let earliestTime = Infinity;
      for (const [id, t] of timers) {
        if (t.time <= now && t.time < earliestTime) {
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

  return {
    now: () => now,
    setTimeout(fn, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { time: now + Math.max(0, Number(delay) || 0), fn, intervalMs: null });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, delay = 0) {
      const id = nextTimerId++;
      const intervalMs = Math.max(1, Number(delay) || 0);
      timers.set(id, { time: now + intervalMs, fn, intervalMs });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    step(ms) {
      now += ms;
      drainDueTimers();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Un client simulato: contesto vm isolato con i propri stub di window/document/canvas/Image, i
// propri listener di tastiera (lo ScenarioPlayer di A non deve "premere tasti" nel motore di B) e il
// proprio Math.random. "bundleCodes" sono gli script (vedi bundleToIife) da eseguire nel contesto:
// i loro export restano leggibili con client.global(nome).
// ---------------------------------------------------------------------------------------------
export function createSimClient({ name, clock, bundleCodes }) {
  const pendingImages = [];

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

  const canvasStub = {
    width: 1024,
    height: 576,
    getContext: () => ctxStub,
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 576, right: 1024, bottom: 576 }),
  };
  const ctxStore = {};
  const ctxStub = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop in ctxStore) return ctxStore[prop];
        if (prop === "canvas") return canvasStub;
        return function noop() {};
      },
      set(_target, prop, value) {
        ctxStore[prop] = value;
        return true;
      },
    },
  );

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
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    location: { search: "" },
  };

  const documentStub = {
    querySelector: () => null,
    createElement: () => ({ style: {}, addEventListener: () => {}, appendChild: () => {}, remove: () => {} }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, innerHTML: "" },
  };

  // I log del gioco vanno su stderr: stdout e' riservato al JSON di output.
  const log = (...args) => console.error(`[${name}]`, ...args);

  const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    performance: { now: clock.now },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    Image: ImageStub,
    KeyboardEvent: KeyboardEventStub,
    addEventListener: addEventListenerStub,
    removeEventListener: removeEventListenerStub,
    dispatchEvent: dispatchEventStub,
    console: { log, info: log, warn: log, error: log, debug: log },
  });

  for (const code of bundleCodes) vm.runInContext(code, context);

  return {
    name,
    canvas: canvasStub,
    global: (globalName) => context[globalName],
    // Stesso evento che genera ScenarioPlayer (src/testbed/scenarioPlayer.ts).
    dispatchKey(type, key) {
      dispatchEventStub(new KeyboardEventStub(type, { key, bubbles: true }));
    },
    // Equivalente di installDeterministicRandom(seed) (src/testbed/rng.ts) nel contesto di questo
    // client: va chiamato subito prima di costruire il motore, come fa main.ts.
    installRandom(seed) {
      vm.runInContext("Math", context).random = mulberry32(seed);
    },
    flushImageLoads,
    handle: null,
    player: null,
    result: null,
    lastSnapshot: null,
    timelineEndedAtMs: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Una partita completa A contro B.
// ---------------------------------------------------------------------------------------------

// Margine massimo oltre la fine della timeline di input: se nessuno ha ancora un esito, la
// simulazione si ferma con un errore invece di girare all'infinito.
const HARD_STOP_EXTRA_MS = 180000;

export function runOneMatch({ gameBundleCode, scenarioBundleCode, scenario, latencyMs = 0 }) {
  const clock = createVirtualClock();
  const clients = {};
  for (const id of ["A", "B"]) {
    const client = createSimClient({ name: id, clock, bundleCodes: [gameBundleCode, scenarioBundleCode] });
    client.gameModule = client.global("__testbedGame");
    client.scenarioModule = client.global("__testbedScenario");
    clients[id] = client;
  }
  const opponentOf = { A: "B", B: "A" };

  for (const id of ["A", "B"]) {
    const client = clients[id];
    const opponent = clients[opponentOf[id]];

    client.installRandom(scenario.seed);

    // "Rete" simulata: lo snapshot viene serializzato come farebbe il layer di trasporto e
    // consegnato all'avversario dopo latencyMs millisecondi di tempo virtuale.
    const onSnapshot = (snapshot) => {
      const payload = JSON.stringify(snapshot);
      client.lastSnapshot = JSON.parse(payload);
      clock.setTimeout(() => {
        opponent.handle?.applyRemoteSnapshot(JSON.parse(payload));
      }, latencyMs);
    };

    client.handle = client.gameModule.createLocalGame(client.canvas, onSnapshot, undefined, scenario.gameConfig, {
      matchMode: "testbed",
      onMatchEnd: (result) => {
        if (client.result) return;
        client.result = { ...JSON.parse(JSON.stringify(result)), endedAtMs: clock.now() };
        client.player?.stop();
      },
      // Come main.ts: con una timeline registrata a frame gli input partono all'inizio del frame.
      onBeforeFrame: (frame) => client.player?.onFrame(frame),
    });
    client.flushImageLoads();

    client.player = new client.scenarioModule.ScenarioPlayer({
      seed: scenario.seed,
      durationMs: scenario.durationMs,
      actions: scenario.players[id].actions,
    });
    client.player.start(() => {
      client.timelineEndedAtMs = clock.now();
    });
  }

  const hardStopMs = scenario.durationMs + HARD_STOP_EXTRA_MS;
  while ((!clients.A.result || !clients.B.result) && clock.now() < hardStopMs) {
    clock.step(FRAME_MS);
    clients.A.flushImageLoads();
    clients.B.flushImageLoads();
  }

  for (const client of Object.values(clients)) {
    client.player?.stop();
    client.handle?.destroy();
  }

  if (!clients.A.result || !clients.B.result) {
    throw new Error(
      `La partita non ha raggiunto un esito entro ${hardStopMs}ms virtuali (timeline ${scenario.durationMs}ms + margine): controllare ondate/azioni dello scenario.`,
    );
  }

  const toPlayerResult = (client) => {
    const r = client.result;
    return {
      finalScore: r.localScore,
      survived: !r.localEliminated,
      finalPositionX: r.finalPositionX,
      finalPositionY: r.finalPositionY,
      actualDurationMs: r.endedAtMs,
      outcome: r.outcome,
      decidedBy: r.decidedBy,
      endReason: r.endReason,
      opponentScore: r.remoteScore,
      eliminatedAtFrame: r.localEliminatedAtFrame,
      lastWaveClearedAtFrame: r.lastWaveClearedAtFrame,
      endFrame: r.endFrame,
      // Se true, la timeline di input e' finita prima dell'esito: il giocatore e' rimasto fermo
      // per l'ultima parte della partita (utile per dimensionare durationMs dello scenario).
      timelineEndedBeforeMatchEnd: client.timelineEndedAtMs !== null && client.timelineEndedAtMs < r.endedAtMs,
    };
  };

  return { A: toPlayerResult(clients.A), B: toPlayerResult(clients.B) };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { repeat: 1, latencyMs: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scenario") args.scenario = argv[++i];
    else if (argv[i] === "--player") args.player = argv[++i];
    else if (argv[i] === "--repeat") args.repeat = Number(argv[++i]);
    else if (argv[i] === "--latency-ms") args.latencyMs = Number(argv[++i]);
  }
  if (!args.scenario || (args.player !== "A" && args.player !== "B")) {
    throw new Error(
      "Uso: node scripts/headless-sim.mjs --scenario <path.json> --player A|B [--repeat N] [--latency-ms L]",
    );
  }
  if (!Number.isFinite(args.latencyMs) || args.latencyMs < 0) {
    throw new Error("--latency-ms deve essere un numero >= 0");
  }
  return args;
}

//  Bundle del codice reale del gioco e di ScenarioPlayer, da passare a runOneMatch(). Esportata
// (insieme a runOneMatch) cosi' altri script possono simulare molte partite nello stesso processo
// senza ricompilare ogni volta. Con includeEngine: true aggiunge anche la classe LocalGameEngine
// (globale "__testbedEngine"), usata da generate-scenario.mjs per leggere lo stato dell'arena.
export async function buildSimulationBundles({ includeEngine = false } = {}) {
  const esbuild = await loadEsbuild();
  const gameBundleCode = await bundleToIife(esbuild, path.join("game", "localGame", "index.ts"), "__testbedGame");
  const scenarioBundleCode = await bundleToIife(
    esbuild,
    path.join("testbed", "scenarioPlayer.ts"),
    "__testbedScenario",
  );
  const engineBundleCode = includeEngine
    ? await bundleToIife(esbuild, path.join("game", "localGame", "LocalGameEngine.ts"), "__testbedEngine")
    : undefined;
  return { gameBundleCode, scenarioBundleCode, engineBundleCode };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarioPath = path.resolve(args.scenario);
  const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  for (const id of ["A", "B"]) {
    if (!scenario.players?.[id]?.actions) {
      throw new Error(`Lo scenario "${scenarioPath}" non ha azioni per il player "${id}".`);
    }
  }

  const { gameBundleCode, scenarioBundleCode } = await buildSimulationBundles();

  const matches = [];
  for (let i = 0; i < args.repeat; i++) {
    matches.push(
      runOneMatch({ gameBundleCode, scenarioBundleCode, scenario, latencyMs: args.latencyMs }),
    );
  }

  const first = matches[0];
  const fingerprint = (match) => JSON.stringify(match);
  const allIdentical = matches.every((match) => fingerprint(match) === fingerprint(first));
  const opponent = args.player === "A" ? "B" : "A";

  const output = {
    scenarioId: scenario.scenarioId ?? path.basename(scenarioPath),
    player: args.player,
    seed: scenario.seed,
    latencyMs: args.latencyMs,
    repeat: args.repeat,
    deterministicAcrossRepeats: allIdentical,
    result: first[args.player],
    opponentResult: first[opponent],
    allResults: args.repeat > 1 ? matches.map((match) => match[args.player]) : undefined,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  if (!allIdentical) process.exitCode = 1;
}

// Eseguito come comando (e non importato da un altro script): parte la CLI.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
