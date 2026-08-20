//  Raccoglie i metadati di un run del testbed (id, protocollo, seed dello scenario, timestamp)
// insieme al log degli input scriptati (vedi scenarioPlayer.ts) e al riepilogo delle metriche di
// rete gia' raccolte da src/metrics/metrics.ts - NON duplicate qui: questo modulo si limita a
// leggerne getSummary() a fine run, senza modificare in alcun modo quel file.
//
//  A fine partita invia il risultato all'endpoint locale POST /api/report, aggiunto al dev server
// Vite via un plugin in vite.config.ts (vedi li' per i dettagli): i risultati di piu' run vengono
// cosi' salvati automaticamente su disco in results/, senza dover cliccare "ESPORTA METRICHE" a
// mano per ognuno. Se l'endpoint non e' raggiungibile (es. build di produzione senza dev server),
// scarica comunque un file JSON come fallback, cosi' il run non va mai perso.
import { getSummary } from "../metrics/metrics";
import type { ScenarioLogEntry } from "./scenarioPlayer";
import type { ActualPlayerResult, DeterminismCheck } from "./determinism";
import type { PlayerId } from "./scenario.types";
import { StateSequenceHasher } from "./stateHash";

export type RunMetadata = {
  runId: string;
  protocol: "moq" | "webrtc";
  scenarioId: string;
  scenarioSeed: number;
  scenarioDurationMs: number;
  player: PlayerId;
  username: string;
  room: string;
};

let meta: RunMetadata | null = null;
let startedAtIso = "";
// TESTBED: accumula un hash deterministico dell'intera sequenza di GameSnapshot locali emessi
// durante il run (vedi stateHash.ts) - a differenza di determinismCheck (solo il risultato finale),
// questo permette di dimostrare che due run corrispondenti (stesso scenarioId/player) tra Mock e
// WebRTC hanno eseguito ESATTAMENTE la stessa sequenza di eventi di gioco, non solo lo stesso esito.
let stateHasher: StateSequenceHasher | null = null;

export function startRun(m: RunMetadata): void {
  meta = m;
  startedAtIso = new Date().toISOString();
  stateHasher = new StateSequenceHasher();
}

//  Da chiamare una volta per ogni GameSnapshot locale emesso durante il run (vedi main.ts,
// nell'onSnapshot gia' esistente) - no-op se nessun run e' stato avviato con startRun().
export function recordSnapshotForHash(snapshot: unknown): void {
  stateHasher?.push(snapshot);
}

export async function finishRun(
  inputLog: ScenarioLogEntry[],
  errors: string[] = [],
  gameResults: ActualPlayerResult | null = null,
  determinismCheck: DeterminismCheck | null = null,
): Promise<void> {
  if (!meta) return;

  const report = {
    runId: meta.runId,
    protocol: meta.protocol,
    scenarioId: meta.scenarioId,
    scenarioSeed: meta.scenarioSeed,
    scenarioDurationMs: meta.scenarioDurationMs,
    player: meta.player,
    username: meta.username,
    room: meta.room,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    metricsSummary: getSummary(),
    gameResults,
    determinismCheck,
    ...(stateHasher?.result() ?? { stateSequenceHash: null, stateSequenceTickCount: 0 }),
    inputLog,
    errors,
  };

  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.info(`[Testbed] run "${meta.runId}" salvato su disco (vedi results/ nel progetto).`);
  } catch (err) {
    console.warn(
      "[Testbed] impossibile salvare il report su /api/report (dev server non raggiungibile?), scarico un file JSON come fallback:",
      err,
    );
    downloadFallback(report);
  }
}

function downloadFallback(report: unknown): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `run-${meta?.runId ?? "unknown"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
