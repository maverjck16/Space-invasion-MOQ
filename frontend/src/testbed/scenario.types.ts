//  Schema condiviso (identico byte-per-byte tra il testbed MoQ e quello WebRTC, vedi TESTBED.md)
// del file di scenario deterministico. Un file scenario-N.json descrive UN esperimento completo:
// seed RNG, durata, room suggerita, configurazione di difficolta' del motore di gioco, le timeline
// di input di ENTRAMBI i giocatori automatici (A e B, con comportamenti volutamente diversi) e i
// risultati attesi di ciascuno (usati a fine partita per il controllo automatico di determinismo,
// vedi determinism.ts).
//
//  IMPORTANTE: A e B condividono lo stesso seed (quindi lo stesso "mondo": stessi spawn di griglie
// e asteroidi, stesso timing, stessa struttura) perche' ciascun client simula il gioco IN LOCALE
// (architettura P2P, nessun server autoritativo - vedi README) e il seed viene installato PRIMA di
// costruire il motore di gioco (vedi rng.ts/main.ts): due seed diversi produrrebbero due mondi
// diversi, non confrontabili. Cio' che differenzia A da B e' SOLO la timeline di azioni
// (players.A.actions vs players.B.actions), che li fa muovere/sparare in modo diverso nello stesso
// mondo, producendo quindi punteggi diversi ma entrambi deterministici.

export type PlayerId = "A" | "B";

export type ScenarioAction =
  | { id: string; timeMs: number; type: "moveX"; dir: "left" | "right" | "none" }
  | { id: string; timeMs: number; type: "moveY"; dir: "up" | "down" | "none" }
  | { id: string; timeMs: number; type: "shoot" };

//  Timeline di input per UN giocatore: sottoinsieme del file scenario completo, ed e' esattamente
// cio' che consuma ScenarioPlayer (che quindi non ha bisogno di sapere nulla di "A"/"B"/multi-player,
// riducendo al minimo le modifiche a un modulo gia' esistente e verificato).
export type PlayerRun = {
  seed: number;
  durationMs: number;
  actions: ScenarioAction[];
};

//  Parametri di difficolta'/carico del motore di gioco per questo scenario. Tutti opzionali lato
// LocalGameEngine (che usa gli stessi valori di default gia' in uso oggi se "gameConfig" non e'
// fornito), cosi' il gioco manuale originale resta bit-per-bit invariato fuori dalla modalita'
// Testbed - vedi LocalGameEngine.ts.
export type ScenarioGameConfig = {
  // Intervallo (in frame a 60fps) tra uno spawn di griglia di invasori e il successivo: valore
  // scelto a caso in [min,max] dopo ogni spawn. Piu' basso = piu' nemici/traffico.
  gridSpawnIntervalFramesMin: number;
  gridSpawnIntervalFramesMax: number;
  // Numero di colonne/righe di ciascuna griglia di invasori (dimensione del "nemico collettivo").
  gridColumnsMin: number;
  gridColumnsMax: number;
  gridRowsMin: number;
  gridRowsMax: number;
  // Intervallo (in frame) tra uno spawn di asteroide e il successivo, quando abilitati.
  asteroidSpawnIntervalFramesMin: number;
  asteroidSpawnIntervalFramesMax: number;
  // Se false, nessun asteroide viene mai generato in questo scenario (riduce una fonte di
  // variabilita' quando non e' l'obiettivo dell'esperimento, vedi scenario-3).
  asteroidsEnabled: boolean;
  // Tetto opzionale al numero totale di asteroidi generati nella partita (vedi
  // game/localGame/types.ts) - usato ad es. da scenario-4 per un pericolo iniziale controllato
  // che non continua a ripresentarsi se il giocatore sopravvive piu' a lungo del previsto.
  asteroidMaxCount?: number;
};

//  Risultato atteso per un giocatore, calcolato offline con il simulatore headless deterministico
// (scripts/headless-sim.mjs) eseguendo la STESSA timeline/seed/config del file scenario. Usato a
// fine partita reale (browser) per il confronto PASS/FAIL, vedi determinism.ts.
export type ScenarioExpectedResult = {
  finalScore: number;
  survived: boolean; // true se il giocatore NON e' morto (game.over === false) alla fine dello scenario
  finalPositionX: number;
  finalPositionY: number;
  actualDurationMs: number; // durata osservata dal simulatore di riferimento (per il confronto di FASE 7)
};

export type Scenario = {
  scenarioId: string;
  description: string;
  seed: number;
  durationMs: number;
  room: string;
  // Tolleranze usate dal controllo di determinismo (vedi determinism.ts): quanto puo' scostarsi un
  // valore osservato dal valore atteso prima di essere considerato un FAIL. Lo score/la posizione
  // devono restare ESATTI (tolleranza 0) perche' dipendono solo dal seed+azioni, mai dal trasporto
  // di rete; la durata ha una piccola tolleranza per il jitter di setTimeout/rAF nel browser reale
  // (vedi il limite onesto documentato in scenarioPlayer.ts).
  durationToleranceMs: number;
  gameConfig: ScenarioGameConfig;
  players: Record<PlayerId, { actions: ScenarioAction[] }>;
  expected: Record<PlayerId, ScenarioExpectedResult>;
};

//  Estrae da un file scenario completo la sola timeline necessaria a ScenarioPlayer per un dato
// giocatore, senza toccare scenarioPlayer.ts.
export function toPlayerRun(scenario: Scenario, player: PlayerId): PlayerRun {
  return {
    seed: scenario.seed,
    durationMs: scenario.durationMs,
    actions: scenario.players[player].actions,
  };
}
