// Calcola (e opzionalmente scrive) i risultati ATTESI di ciascuno scenario/player usando il
// simulatore headless reale (scripts/headless-sim.mjs, che esegue il VERO codice del motore di
// gioco - non una riscrittura), e verifica che siano riproducibili bit-per-bit su piu' ripetizioni
// indipendenti (FASE 7 della tesi: distinguere "il trasporto ha avuto prestazioni diverse" da "i
// due esperimenti hanno eseguito partite diverse" richiede prima di tutto sapere che, a parita' di
// scenario, il gameplay locale e' sempre identico).
//
//  Uso:
//    node scripts/verify-determinism.mjs                 # calcola e stampa PASS/FAIL, non scrive nulla
//    node scripts/verify-determinism.mjs --write          # scrive anche il campo "expected" nei file scenario-N.json
//    node scripts/verify-determinism.mjs --repeat 5        # ripetizioni per il controllo di riproducibilita' (default 3)
//
//  Byte-per-byte identico tra i due testbed (vedi TESTBED.md), individua da solo la cartella
// public/scenarios corretta con la stessa logica di generate-scenario.mjs/headless-sim.mjs.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

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
  const args = { write: false, repeat: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write") args.write = true;
    else if (argv[i] === "--repeat") args.repeat = Number(argv[++i]);
  }
  return args;
}

function runHeadlessSim(scenarioPath, player, repeat) {
  const scriptPath = path.join(__dirname, "headless-sim.mjs");
  const out = execFileSync(
    process.execPath,
    [scriptPath, "--scenario", scenarioPath, "--player", player, "--repeat", String(repeat)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
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

  let anyFail = false;
  const summary = [];

  for (const file of files) {
    const scenarioPath = path.join(scenariosDir, file);
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
    console.log(`\n=== ${scenario.scenarioId} (seed=${scenario.seed}, durationMs=${scenario.durationMs}) ===`);

    const expected = {};
    for (const player of ["A", "B"]) {
      const sim = runHeadlessSim(scenarioPath, player, args.repeat);
      const detStatus = sim.deterministicAcrossRepeats ? "PASS" : "FAIL";
      if (!sim.deterministicAcrossRepeats) anyFail = true;

      console.log(
        `  Player ${player}: score=${sim.result.finalScore} survived=${sim.result.survived} ` +
          `pos=(${sim.result.finalPositionX.toFixed(1)}, ${sim.result.finalPositionY.toFixed(1)}) ` +
          `durationMs=${sim.result.actualDurationMs.toFixed(1)} | ripetibilita' (${args.repeat}x): ${detStatus}`,
      );

      summary.push({ scenarioId: scenario.scenarioId, player, ...sim.result, deterministicAcrossRepeats: sim.deterministicAcrossRepeats });

      expected[player] = {
        finalScore: sim.result.finalScore,
        survived: sim.result.survived,
        finalPositionX: sim.result.finalPositionX,
        finalPositionY: sim.result.finalPositionY,
        actualDurationMs: sim.result.actualDurationMs,
      };
    }

    if (args.write) {
      scenario.expected = expected;
      fs.writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2) + "\n");
      console.log(`  -> "expected" scritto in ${scenarioPath}`);
    }
  }

  console.log(`\n${anyFail ? "ALCUNI CONTROLLI DI RIPRODUCIBILITA' SONO FALLITI" : "Tutti gli scenari sono riproducibili bit-per-bit."}`);
  if (anyFail) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
