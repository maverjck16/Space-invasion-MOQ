// Genera i 2 file di scenario deterministico (scenario-1.json, scenario-2.json) usati dal
// testbed al posto del controllo manuale da tastiera (vedi frontend/src/testbed/scenarioPlayer.ts
// e frontend/src/testbed/scenario.types.ts per lo schema).
//
//  Ogni scenario contiene DUE timeline di input indipendenti (players.A / players.B): stesso seed
// RNG (quindi stesso "mondo": stessi spawn di griglie/asteroidi) ma azioni diverse, cosi' i due
// giocatori automatici si muovono/sparano in modo diverso e ottengono punteggi diversi pur restando
// entrambi completamente deterministici - vedi il commento in scenario.types.ts sul perche' il seed
// e' condiviso. Il campo "expected" viene lasciato vuoto qui: e' scripts/verify-determinism.mjs
// (che usa il simulatore headless reale, scripts/headless-sim.mjs) a calcolarlo e scriverlo, cosi'
// il valore atteso e' sempre generato eseguendo DAVVERO il motore di gioco, mai a mano.
//
//  Esegui con: node scripts/generate-scenario.mjs
// poi: node scripts/verify-determinism.mjs --write   (calcola gli "expected" e verifica il determinismo)
//
//  Questo script e' mantenuto byte-per-byte identico tra il testbed MoQ e quello WebRTC (vedi
// TESTBED.md): individua da solo la cartella "frontend" corretta (TS/frontend per MoQ, frontend
// per WebRTC - una differenza storica di struttura tra i due progetti) e scrive in
// <frontend>/public/scenarios/scenario-N.json in entrambi, cosi' lo stesso comando produce file
// byte-identici nei due repository (verificabile con "diff").
//
//  Storico: originariamente c'erano 4 scenari (scenario-1 "baseline", scenario-2 "medium load",
// scenario-3 "long/stress", scenario-4 "medium/realistic"). scenario-1 e scenario-2 originali sono
// stati rimossi; scenario-3 e scenario-4 sono diventati rispettivamente lo scenario-1 e lo
// scenario-2 attuali. Lo scenario-1 attuale (ex scenario-3) e' stato inoltre riscritto per usare
// buildRealisticActions() invece del vecchio pattern "spazza lo schermo sparando in continuazione"
// (buildSweepActions/buildStressActions, rimosse insieme agli scenari che le usavano): stesso
// seed/gameConfig di prima (60s, asteroidi disattivati, griglie molto frequenti), ma sparo a
// raffiche brevi separate da pause e beccheggio verticale periodico come nello scenario-2, con
// cadenza piu' serrata per reggere il carico piu' alto di questo scenario.

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
// buildRealisticActions: timeline di sweep orizzontale + sparo a raffiche brevi separate da pause
// (invece del pattern "spazza lo schermo sparando in continuazione") + beccheggio verticale
// periodico, pensata per assomigliare a una partita giocata da una persona vera pur restando
// scriptata e deterministica. Usata da entrambi gli scenari attuali.
// -------------------------------------------------------------------------------------------
// -------------------------------------------------------------------------------------------
// SCENARIO 4 - Medium/realistic: griglie piu' popolate (piu' invasori per griglia) e qualche
// asteroide (ne' assenti come scenario-3 ne' frequenti come scenario-2), pensato per assomigliare
// a una partita giocata da una persona vera piuttosto che al pattern "spazza lo schermo sparando
// in continuazione" degli altri scenari: cadenza di sparo piu' bassa, a raffiche separate da
// pause (invece di uno sparo quasi ad ogni tratto), e un beccheggio verticale che si ripete per
// tutta la partita (non un singolo movimento a inizio scenario come in buildSweepActions/
// buildStressActions).
// -------------------------------------------------------------------------------------------

//  A differenza di buildSweepActions (giu'/su una tantum a inizio partita), qui il movimento
// verticale si ripete periodicamente per tutta la durata, alternando su/giu', per dare l'idea di
// un giocatore che "schiva" invece di restare fermo sull'asse Y - resta comunque una timeline
// fissa e deterministica (nessuna scelta a runtime), solo con piu' eventi pianificati in anticipo.
function buildRealisticActions({
  durationMs,
  startDir,
  legMs,
  shootBurstPattern, // pause (ms) tra uno sparo e il successivo, ripetute ciclicamente
  verticalPeriodMs,
  verticalHoldMs,
  verticalStartDir, // "up" | "down" - direzione del primo beccheggio
  verticalPhaseOffsetMs = 0,
  // Nessun beccheggio verticale prima di questo istante: durante la finestra iniziale in cui
  // possono arrivare asteroidi (target fissato alla posizione del giocatore nell'istante di spawn,
  // vedi Asteroid.ts) un giocatore che smette di muoversi in verticale per restare "in ostaggio" di
  // un movimento programmato ha piu' probabilita' di trovarsi fermo esattamente sulla traiettoria -
  // verificato empiricamente con il simulatore headless strumentato.
  verticalStartAfterMs = 0,
  // Manovra evasiva esplicita: tiene il tasto verticale premuto in una direzione per tutta la
  // finestra [startMs, endMs] (invece del beccheggio periodico su/giu', che di per se' non basta a
  // evitare un asteroide il cui bersaglio era fissato a inizio finestra - verificato empiricamente:
  // un giocatore che continua ad allontanarsi in verticale per tutta la finestra di pericolo, invece
  // di fermarsi dopo una breve pressione, aumenta nel tempo la distanza dal bersaglio originale
  // dell'asteroide).
  evasionWindow, // { startMs, endMs, dir: "up" | "down" } oppure undefined
  // Finestra opzionale di sparo concentrato ("scarica") sovrapposta al pattern normale, per un
  // periodo in cui si vuole massimizzare le probabilita' di colpire piu' invasori possibile (es.
  // subito dopo la comparsa di una griglia).
  burstWindow, // { startMs, endMs, intervalMs } oppure undefined
  movementEndMarginMs = 2000,
}) {
  idCounter = 1;
  const actions = [];
  const push = (timeMs, type, extra) => actions.push(makeAction(timeMs, type, extra));

  // Sweep orizzontale con leg piu' lunghi di buildSweepActions => meno cambi di direzione al
  // secondo, movimento piu' "naturale" e meno frenetico.
  const endMovementMs = durationMs - movementEndMarginMs;
  let dir = startDir;
  let x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
  let t = 0;

  while (t < endMovementMs) {
    push(t, "moveX", { dir });
    const delta = (dir === "right" ? 1 : -1) * legMs * PLAYER_SPEED_PX_PER_MS;
    x = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_WIDTH, x + delta));
    if (x <= 4) dir = "right";
    else if (x >= CANVAS_WIDTH - PLAYER_WIDTH - 4) dir = "left";
    t += legMs;
  }
  push(t, "moveX", { dir: "none" });

  // Manovra evasiva: tasto verticale tenuto premuto per l'intera finestra (non solo un breve
  // impulso), cosi' la distanza dal punto in cui l'asteroide puntava a inizio finestra continua ad
  // aumentare invece di stabilizzarsi.
  if (evasionWindow) {
    push(evasionWindow.startMs, "moveY", { dir: evasionWindow.dir });
    push(evasionWindow.endMs, "moveY", { dir: "none" });
  }

  // Beccheggio verticale periodico: alterna su/giu' ogni "verticalPeriodMs", tenendo il tasto
  // premuto per "verticalHoldMs" prima di tornare a "none" - ripetuto per tutta la durata invece
  // che una volta sola, per un profilo di volo meno piatto/prevedibile. Parte solo dopo
  // "verticalStartAfterMs" (vedi sopra).
  let verticalDir = verticalStartDir;
  for (let vt = verticalPhaseOffsetMs; vt < durationMs - 300; vt += verticalPeriodMs) {
    if (vt >= verticalStartAfterMs) {
      push(vt, "moveY", { dir: verticalDir });
      push(Math.min(vt + verticalHoldMs, durationMs - 200), "moveY", { dir: "none" });
    }
    verticalDir = verticalDir === "up" ? "down" : "up";
  }

  // Sparo a raffiche brevi separate da pause piu' lunghe (invece di sparo pressoche' continuo),
  // seguendo "shootBurstPattern" (intervalli in ms tra uno sparo e il successivo) ripetuto in
  // ciclo per tutta la durata - fisso e deterministico, solo meno denso/regolare degli altri
  // scenari (che sparano quasi ad ogni tratto del sweep). Durante un'eventuale "burstWindow" lo
  // sparo concentrato la sostituisce (intervallo fisso e molto piu' fitto).
  let shootT = 300;
  let patternIndex = 0;
  while (shootT < durationMs - 300) {
    const inBurst = burstWindow && shootT >= burstWindow.startMs && shootT <= burstWindow.endMs;
    push(shootT, "shoot");
    if (inBurst) {
      shootT += burstWindow.intervalMs;
    } else {
      shootT += shootBurstPattern[patternIndex % shootBurstPattern.length];
      patternIndex += 1;
    }
  }

  actions.sort((a, b) => a.timeMs - b.timeMs);
  return actions;
}

// -------------------------------------------------------------------------------------------
// SCENARIO 1 (ex scenario-3) - Long/stress: 60s, asteroidi disattivati (riduce una fonte di
// variabilita', vedi gameConfig.asteroidsEnabled), griglie molto frequenti. Stesso seed/gameConfig
// della versione precedente di questo scenario (stesso "mondo": stessi spawn di griglie), ma
// azioni riscritte con buildRealisticActions() invece del vecchio sweep-e-spara continuo: sparo a
// raffiche brevi separate da pause e beccheggio verticale periodico come scenario-2, con cadenza
// piu' serrata (legMs/pausa piu' brevi) per reggere il carico piu' alto di questo scenario.
// -------------------------------------------------------------------------------------------
const SCENARIO_1 = {
  scenarioId: "scenario-1",
  description:
    "Long: 60s, asteroidi disattivati, griglie molto frequenti - stesso stile di scenario-2 (sparo a raffiche brevi separate da pause, beccheggio verticale periodico, niente 'sparo a manetta' continuo), ma con cadenza piu' serrata per reggere il carico piu' alto di questo scenario.",
  seed: 4242,
  durationMs: 60000,
  room: "room-test-1",
  durationToleranceMs: 600,
  gameConfig: {
    gridSpawnIntervalFramesMin: 480,
    gridSpawnIntervalFramesMax: 779,
    gridColumnsMin: 3,
    gridColumnsMax: 4,
    gridRowsMin: 1,
    gridRowsMax: 2,
    asteroidSpawnIntervalFramesMin: 999999,
    asteroidSpawnIntervalFramesMax: 999999,
    asteroidsEnabled: false,
  },
  players: {
    A: {
      actions: buildRealisticActions({
        durationMs: 60000,
        startDir: "left",
        legMs: 280,
        shootBurstPattern: [200, 200, 350],
        verticalPeriodMs: 3400,
        verticalHoldMs: 400,
        verticalStartDir: "down",
        verticalPhaseOffsetMs: 500,
        verticalStartAfterMs: 0,
      }),
    },
    B: {
      actions: buildRealisticActions({
        durationMs: 60000,
        startDir: "right",
        legMs: 180,
        shootBurstPattern: [170, 170, 300],
        verticalPeriodMs: 3400,
        verticalHoldMs: 400,
        verticalStartDir: "down",
        verticalPhaseOffsetMs: 800,
        verticalStartAfterMs: 0,
      }),
    },
  },
  expected: {},
};

const SCENARIO_2 = {
  scenarioId: "scenario-2",
  description:
    "Medium/realistic: griglie piu' popolate (piu' invasori) e qualche asteroide (ne' assenti come nello scenario-1 ne' particolarmente frequenti), sparo a raffiche intervallate da pause (non continuo, niente 'sparo a manetta') e beccheggio verticale periodico - pensato per assomigliare a una partita giocata da una persona, restando comunque scriptato e deterministico.",
  seed: 6200,
  durationMs: 40000,
  room: "room-test-2",
  durationToleranceMs: 500,
  gameConfig: {
    // TESTBED: nota implementativa importante (vedi LocalGameEngine.animate()) - lo spawn di una
    // griglia AZZERA "this.frames", lo stesso contatore usato anche per il timer degli asteroidi:
    // se l'intervallo asteroidi non e' chiaramente piu' basso di quello delle griglie, le griglie
    // resettano il contatore prima che l'asteroide scatti mai (verificato: con un intervallo
    // asteroidi troppo vicino/superiore a quello delle griglie si ottengono 0 asteroidi in tutta la
    // partita). Al contrario, un intervallo asteroidi troppo aggressivo rispetto a quello delle
    // griglie fa apparire piu' asteroidi PRIMA che il giocatore veda il primo alieno (anche questo
    // verificato empiricamente con il simulatore headless, strumentato temporaneamente per
    // registrare istante di spawn/lato di ogni asteroide e istante+causa di ogni morte). I valori
    // qui sotto sono stati scelti verificando la timeline risultante (non a tentativi alla cieca):
    // con questo seed, entrambi i giocatori vedono 2 asteroidi provenire dall'alto (~7.5-8s) seguiti
    // da un'ondata di alieni consistente (8-15 invasori, ~11.6s) prima di soccombere.
    gridSpawnIntervalFramesMin: 500,
    gridSpawnIntervalFramesMax: 750,
    gridColumnsMin: 4,
    gridColumnsMax: 6,
    gridRowsMin: 1,
    gridRowsMax: 3,
    asteroidSpawnIntervalFramesMin: 380,
    asteroidSpawnIntervalFramesMax: 580,
    asteroidsEnabled: true,
    // Non generare altri asteroidi oltre ai 2 iniziali (vedi game/localGame/types.ts) - anche se il
    // giocatore sopravvive piu' a lungo del run di riferimento, non ne arriveranno altri.
    asteroidMaxCount: 2,
  },
  players: {
    A: {
      actions: buildRealisticActions({
        durationMs: 40000,
        startDir: "left",
        legMs: 500,
        shootBurstPattern: [550, 550, 1100], // due colpi ravvicinati poi una pausa piu' lunga (fuori da burstWindow)
        verticalPeriodMs: 3600,
        verticalHoldMs: 500,
        verticalStartDir: "down",
        verticalPhaseOffsetMs: 500,
        // Nessun beccheggio verticale prima che i 2 asteroidi iniziali (~7.5-8s) siano passati: un
        // asteroide entra dall'alto dello schermo (spawn y negativa) diretto verso il basso, quindi
        // muoversi verso l'alto lo intercetta PRIMA (stesso corridoio verticale, percorso in comune
        // piu' lungo) - verificato empiricamente con il simulatore headless strumentato che questo
        // peggiora la sopravvivenza. Restare sulla quota bassa di partenza e affidarsi al movimento
        // orizzontale per disallinearsi in X, invece, non basta da solo (provato un'ampia gamma di
        // legMs, sempre colpito): la vera differenza la fa sparare presto (vedi burstWindow sotto),
        // che distrugge gli asteroidi prima che arrivino invece di limitarsi a schivarli.
        verticalStartAfterMs: 8600,
        // "Scarica" di proiettili che comincia appena dopo lo spawn dei 2 asteroidi iniziali (~7.5s)
        // e continua nella finestra in cui arriva la prima ondata di alieni: verificato con il
        // simulatore headless che questo distrugge gli asteroidi (niente piu' "asteroid" tra le
        // cause di game over) e uccide diversi invasori, spostando la sopravvivenza da ~12.4s a
        // ~28.2s (score 1310, contro lo score 0 della versione precedente).
        burstWindow: { startMs: 7300, endMs: 16000, intervalMs: 100 },
      }),
    },
    B: {
      actions: buildRealisticActions({
        durationMs: 40000,
        startDir: "right",
        legMs: 380,
        shootBurstPattern: [700, 1400], // un colpo, pausa piu' lunga - fuori da burstWindow
        verticalPeriodMs: 3200,
        verticalHoldMs: 600,
        verticalStartDir: "up",
        verticalPhaseOffsetMs: 1600,
        verticalStartAfterMs: 8600, // stesso motivo di A
        // Stessa idea/finestra di A (intervallo/durata identici): la prima versione (60ms per
        // 17.7s) sparava troppo, quasi un mitragliatore - questa versione, piu' misurata, distrugge
        // comunque entrambi gli asteroidi iniziali e buona parte della prima ondata di alieni.
        burstWindow: { startMs: 7300, endMs: 16000, intervalMs: 100 },
      }),
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
