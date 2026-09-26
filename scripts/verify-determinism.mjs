// Calcola (e opzionalmente scrive) i risultati ATTESI di ciascuno scenario/player usando il
// simulatore headless reale (scripts/headless-sim.mjs, che esegue il VERO codice del motore di
// gioco - non una riscrittura), e verifica che siano riproducibili bit-per-bit su piu' ripetizioni
// indipendenti (FASE 7 della tesi: distinguere "il trasporto ha avuto prestazioni diverse" da "i
// due esperimenti hanno eseguito partite diverse" richiede prima di tutto sapere che, a parita' di
// scenario, il gameplay e' sempre identico).
//
//  TESTBED 1v1: la partita automatica si gioca in due nella stessa arena, quindi ogni simulazione
// gioca A e B insieme e i risultati attesi dei due giocatori vengono dalla stessa partita (rete
// ideale, latenza 0). Lo script controlla anche che i due esiti siano complementari e ripete la
// partita con alcune latenze di rete simulate: esito e sopravvivenza devono restare gli stessi,
// punteggio e durata entro le tolleranze dello scenario (scoreTolerance, durationToleranceMs).
//
//  Uso:
//    node scripts/verify-determinism.mjs                 # calcola e stampa PASS/FAIL, non scrive nulla
//    node scripts/verify-determinism.mjs --write          # scrive anche il campo "expected" nei file scenario-N.json
//    node scripts/verify-determinism.mjs --repeat 5        # ripetizioni per il controllo di riproducibilita' (default 3)
//    node scripts/verify-determinism.mjs --latencies 20,40,80,150   # latenze (ms) del controllo di robustezza
//
//  Byte-per-byte identico tra i due testbed (vedi TESTBED.md), individua da solo la cartella
// public/scenarios corretta con la stessa logica di generate-scenario.mjs/headless-sim.mjs.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildSimulationBundles, runOneMatch } from "./headless-sim.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(__dirname);

function resolveScenariosDir() {
  const candidates = [
    path.join(projectRoot, "TS", "frontend", "public", "scenarios"),
    path.join(projectRoot, "frontend", "public", "scenarios"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Cartella scenarios/ non trovata (provati: ${candidates.join(", ")}). Esegui prima generate-scenario.mjs.`,
  );
}

function parseArgs(argv) {
  const args = { write: false, repeat: 3, latencies: [20, 40, 80, 150] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write") args.write = true;
    else if (argv[i] === "--repeat") args.repeat = Number(argv[++i]);
    else if (argv[i] === "--latencies") {
      args.latencies = argv[++i]
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value >= 0);
    }
  }
  return args;
}

// Campi del risultato atteso (vedi ScenarioExpectedResult in src/testbed/scenario.types.ts).
function toExpected(result) {
  return {
    finalScore: result.finalScore,
    survived: result.survived,
    finalPositionX: result.finalPositionX,
    finalPositionY: result.finalPositionY,
    actualDurationMs: result.actualDurationMs,
    outcome: result.outcome,
    decidedBy: result.decidedBy,
    opponentScore: result.opponentScore,
    eliminatedAtFrame: result.eliminatedAtFrame,
    lastWaveClearedAtFrame: result.lastWaveClearedAtFrame,
    endFrame: result.endFrame,
  };
}

const COMPLEMENTARY_OUTCOME = { win: "lose", lose: "win", draw: "draw" };

function describe(result) {
  const eliminated = result.survived ? "sopravvive" : `eliminato al frame ${result.eliminatedAtFrame}`;
  return (
    `${result.outcome} (${result.decidedBy}) score=${result.finalScore} ${eliminated} ` +
    `pos=(${result.finalPositionX.toFixed(1)}, ${result.finalPositionY.toFixed(1)}) ` +
    `durationMs=${result.actualDurationMs.toFixed(1)}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenariosDir = resolveScenariosDir();
  const files = fs
    .readdirSync(scenariosDir)
    .filter((f) => /^scenario-\d+\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`Nessuno scenario-N.json trovato in ${scenariosDir}. Esegui prima generate-scenario.mjs.`);
  }

  const bundles = await buildSimulationBundles();
  let anyFail = false;
  let anyWarning = false;

  for (const file of files) {
    const scenarioPath = path.join(scenariosDir, file);
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
    const scoreTolerance = scenario.scoreTolerance ?? 0;
    const durationTolerance = scenario.durationToleranceMs ?? 0;
    console.log(`\n=== ${scenario.scenarioId} (seed=${scenario.seed}, timeline ${scenario.durationMs} ms) ===`);

    // 1) Riproducibilita': N partite indipendenti con rete ideale devono essere identiche.
    const matches = [];
    for (let i = 0; i < args.repeat; i++) {
      matches.push(runOneMatch({ ...bundles, scenario, latencyMs: 0 }));
    }
    const reference = matches[0];
    const reproducible = matches.every((match) => JSON.stringify(match) === JSON.stringify(reference));
    if (!reproducible) anyFail = true;

    for (const player of ["A", "B"]) {
      console.log(`  Player ${player}: ${describe(reference[player])}`);
    }
    console.log(`  Riproducibilita' (${args.repeat}x): ${reproducible ? "PASS" : "FAIL"}`);

    // 2) Coerenza tra i due lati della stessa partita.
    const consistent =
      COMPLEMENTARY_OUTCOME[reference.A.outcome] === reference.B.outcome &&
      reference.A.decidedBy === reference.B.decidedBy &&
      reference.A.opponentScore === reference.B.finalScore &&
      reference.B.opponentScore === reference.A.finalScore;
    if (!consistent) anyFail = true;
    console.log(`  Esiti complementari tra A e B: ${consistent ? "PASS" : "FAIL"}`);

    // 3) Robustezza rispetto alla latenza di rete.
    for (const latencyMs of args.latencies) {
      const match = runOneMatch({ ...bundles, scenario, latencyMs });
      const problems = [];
      for (const player of ["A", "B"]) {
        const expected = reference[player];
        const actual = match[player];
        if (actual.outcome !== expected.outcome) problems.push(`${player}: esito ${actual.outcome}`);
        if (actual.survived !== expected.survived) problems.push(`${player}: sopravvivenza ${actual.survived}`);
        if (Math.abs(actual.finalScore - expected.finalScore) > scoreTolerance) {
          problems.push(`${player}: punteggio ${actual.finalScore}`);
        }
        if (Math.abs(actual.actualDurationMs - expected.actualDurationMs) > durationTolerance) {
          problems.push(`${player}: durata ${actual.actualDurationMs.toFixed(0)} ms`);
        }
      }
      const scores = `A=${match.A.finalScore} B=${match.B.finalScore}`;
      if (problems.length > 0) {
        anyWarning = true;
        console.log(`  Latenza ${latencyMs} ms: ATTENZIONE (${problems.join("; ")})`);
      } else {
        console.log(`  Latenza ${latencyMs} ms: stesso esito (${scores})`);
      }
    }

    if (args.write) {
      scenario.expected = { A: toExpected(reference.A), B: toExpected(reference.B) };
      fs.writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2) + "\n");
      console.log(`  -> "expected" scritto in ${scenarioPath}`);
    }
  }

  if (anyFail) {
    console.log("\nALCUNI CONTROLLI SONO FALLITI (riproducibilita' o coerenza tra A e B).");
    process.exitCode = 1;
  } else if (anyWarning) {
    console.log(
      "\nScenari riproducibili, ma con qualche latenza simulata l'esito o i valori escono dalle tolleranze: vedi le righe ATTENZIONE.",
    );
  } else {
    console.log("\nTutti gli scenari sono riproducibili bit-per-bit e stabili rispetto alla latenza simulata.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
