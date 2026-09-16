//  Confronto automatico tra il risultato REALE di un run (osservato nel browser: esito della
// partita comunicato dal motore di gioco, vedi main.ts) e il risultato ATTESO per quel
// giocatore/scenario (calcolato offline dal simulatore headless deterministico, vedi
// scripts/headless-sim.mjs, e imbustato nel file scenario stesso - vedi scenario.types.ts, campo
// "expected").
//
//  TESTBED 1v1: nella partita automatica i due giocatori condividono l'arena, quindi il risultato
// di ciascuno dipende anche da quando arrivano le eliminazioni fatte dall'avversario. Il
// simulatore calcola il riferimento con una rete ideale (latenza configurabile, di default 0): una
// differenza qui puo' quindi dipendere anche dalla latenza reale e non solo da un problema di
// determinismo del gioco (vedi TESTBED.md).
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
  // TESTBED 1v1: esito e dati di fine partita (vedi MatchResult in game/localGame/types.ts),
  // salvati nel report del run anche se non tutti entrano nel confronto PASS/FAIL.
  outcome?: "win" | "lose" | "draw";
  endReason?: "timeUp" | "bothEliminated" | "lastWaveCleared";
  decidedBy?: "eliminationOrder" | "survival" | "score";
  opponentScore?: number;
  opponentSurvived?: boolean;
  eliminatedAtFrame?: number | null;
  opponentEliminatedAtFrame?: number | null;
  lastWaveClearedAtFrame?: number | null;
  endFrame?: number;
  opponentFinalStateReceived?: boolean;
};

export type DeterminismCheckItem = {
  field: string;
  expected: number | boolean | string;
  actual: number | boolean | string;
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

function checkString(field: string, expected: string, actual: string): DeterminismCheckItem {
  return { field, expected, actual, tolerance: 0, pass: expected === actual };
}

//  "UNKNOWN" invece di PASS/FAIL quando non abbiamo un risultato atteso per questo scenario/player
// (es. scenario custom generato senza passare da scripts/verify-determinism.mjs --write): non
// dichiariamo mai un esito che non abbiamo davvero potuto verificare.
export function checkDeterminism(
  scenario: Pick<Scenario, "scenarioId" | "durationToleranceMs" | "scoreTolerance" | "expected">,
  player: PlayerId,
  actual: ActualPlayerResult,
): DeterminismCheck {
  const expected: ScenarioExpectedResult | undefined = scenario.expected?.[player];

  if (!expected) {
    return { scenarioId: scenario.scenarioId, player, status: "UNKNOWN", checks: [] };
  }

  //  TESTBED 1v1: la partita non dura piu' esattamente "durationMs" (finisce con l'esito, vedi
  // scenario.types.ts), quindi la durata osservata si confronta con quella del simulatore.
  const checks: DeterminismCheckItem[] = [
    checkNumber("finalScore", expected.finalScore, actual.finalScore, scenario.scoreTolerance ?? 0),
    checkBoolean("survived", expected.survived, actual.survived),
    checkNumber("finalPositionX", expected.finalPositionX, actual.finalPositionX, 0.5),
    checkNumber("finalPositionY", expected.finalPositionY, actual.finalPositionY, 0.5),
    checkNumber(
      "actualDurationMs",
      expected.actualDurationMs,
      actual.actualDurationMs,
      scenario.durationToleranceMs,
    ),
  ];
  if (expected.outcome !== undefined) {
    checks.push(checkString("outcome", expected.outcome, actual.outcome ?? "unknown"));
  }

  const status = checks.every((c) => c.pass) ? "PASS" : "FAIL";
  return { scenarioId: scenario.scenarioId, player, status, checks };
}
