//  Confronto automatico tra il risultato REALE di un run (osservato nel browser: ultimo snapshot
// locale disponibile a fine scenario) e il risultato ATTESO per quel giocatore/scenario (calcolato
// offline dal simulatore headless deterministico, vedi scripts/headless-sim.mjs, e imbustato nel
// file scenario stesso - vedi scenario.types.ts, campo "expected").
//
//  Obiettivo (vedi FASE 7 della tesi): distinguere "il trasporto di rete ha avuto prestazioni
// diverse" da "i due esperimenti hanno semplicemente eseguito partite diverse". Se questo controllo
// da' PASS, sappiamo che il gameplay locale (che non dipende MAI dal trasporto MoQ/WebRTC, solo da
// seed+azioni scriptate) si e' comportato esattamente come previsto: qualunque differenza osservata
// tra i due protocolli nelle METRICHE DI RETE e' quindi imputabile al trasporto, non al gioco.
import type { PlayerId, Scenario, ScenarioExpectedResult } from "./scenario.types";

export type ActualPlayerResult = {
  finalScore: number;
  survived: boolean;
  finalPositionX: number;
  finalPositionY: number;
  actualDurationMs: number;
};

export type DeterminismCheckItem = {
  field: string;
  expected: number | boolean;
  actual: number | boolean;
  tolerance: number;
  pass: boolean;
};

export type DeterminismCheck = {
  scenarioId: string;
  player: PlayerId;
  status: "PASS" | "FAIL" | "UNKNOWN";
  checks: DeterminismCheckItem[];
};

function checkNumber(
  field: string,
  expected: number,
  actual: number,
  tolerance: number,
): DeterminismCheckItem {
  return {
    field,
    expected,
    actual,
    tolerance,
    pass: Math.abs(expected - actual) <= tolerance,
  };
}

function checkBoolean(field: string, expected: boolean, actual: boolean): DeterminismCheckItem {
  return { field, expected, actual, tolerance: 0, pass: expected === actual };
}

//  "UNKNOWN" invece di PASS/FAIL quando non abbiamo un risultato atteso per questo scenario/player
// (es. scenario custom generato senza passare da scripts/verify-determinism.mjs --write): non
// dichiariamo mai un esito che non abbiamo davvero potuto verificare.
export function checkDeterminism(
  scenario: Pick<Scenario, "scenarioId" | "durationMs" | "durationToleranceMs" | "expected">,
  player: PlayerId,
  actual: ActualPlayerResult,
): DeterminismCheck {
  const expected: ScenarioExpectedResult | undefined = scenario.expected?.[player];

  if (!expected) {
    return { scenarioId: scenario.scenarioId, player, status: "UNKNOWN", checks: [] };
  }

  const checks: DeterminismCheckItem[] = [
    checkNumber("finalScore", expected.finalScore, actual.finalScore, 0),
    checkBoolean("survived", expected.survived, actual.survived),
    checkNumber("finalPositionX", expected.finalPositionX, actual.finalPositionX, 0.5),
    checkNumber("finalPositionY", expected.finalPositionY, actual.finalPositionY, 0.5),
    checkNumber(
      "actualDurationMs",
      scenario.durationMs,
      actual.actualDurationMs,
      scenario.durationToleranceMs,
    ),
  ];

  const status = checks.every((c) => c.pass) ? "PASS" : "FAIL";
  return { scenarioId: scenario.scenarioId, player, status, checks };
}
