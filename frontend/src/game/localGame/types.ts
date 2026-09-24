import type { GameSnapshot } from "../../webrtc/snapshot";
import type { ArenaGameConfig, ArenaMatchResult } from "../../arena/arenaClient";

//  1v1 - server autoritativo: "GameDifficultyConfig"/"ScriptedWave"/"ScriptedAsteroidEvent" non
// sono piu' consumati direttamente da LocalGameEngine (che non simula piu' l'arena in locale, vedi
// piu' sotto): restano qui solo perche' main.ts li legge da uno scenario del testbed (vedi
// testbed/scenario.types.ts) per inoltrarli AL SERVER dell'arena nel messaggio di join (vedi
// arena/arenaClient.ts, campo "gameConfig") - il server e' l'unico a usarli davvero (vedi
// arena-server/simulation.js). Tipo mantenuto identico per non dover riscrivere gli scenari gia'
// esistenti.
export type GameDifficultyConfig = {
  gridSpawnIntervalFramesMin: number;
  gridSpawnIntervalFramesMax: number;
  gridColumnsMin: number;
  gridColumnsMax: number;
  gridRowsMin: number;
  gridRowsMax: number;
  asteroidSpawnIntervalFramesMin: number;
  asteroidSpawnIntervalFramesMax: number;
  asteroidsEnabled: boolean;
  asteroidMaxCount?: number;
  scriptedWaves?: ScriptedWave[];
  scriptedAsteroids?: ScriptedAsteroidEvent[];
};

export type ScriptedWave = {
  minStartFrame: number;
  columns: number;
  rows: number;
  canShoot: boolean;
  spawnAsteroid?: boolean;
};

export type ScriptedAsteroidEvent = {
  minStartFrame: number;
};

//definisco i tipi per le entità di gioco e le loro proprietà, così come le opzioni per inizializzare il gioco locale
export type LocalGameOptions = {
  canvas: HTMLCanvasElement;
  // 1v1: nome con cui questo client si e' unito alla stanza dell'arena - serve a leggere la
  // propria voce in ArenaSnapshot.players (vedi arena/arenaClient.ts).
  username: string;
  //funzione di callback per inviare snapshot COSMETICI (propria navicella/propri proiettili) al publisher P2P
  onSnapshot: (snapshot: GameSnapshot) => void;
  // 1v1: inoltra al server dell'arena lo stato della propria navicella / un colpo appena sparato -
  // vedi arena/arenaClient.ts. E' l'unico canale che conta davvero ai fini del punteggio/delle
  // collisioni: onSnapshot sopra resta puramente per il rendering fluido lato avversario.
  sendArenaState: (state: { x: number; y: number; width: number; height: number }) => void;
  sendArenaFire: (shot: { id: string; x: number; y: number; vx: number; vy: number; radius: number }) => void;
  //funzione di callback opzionale per notificare il publisher quando il punteggio cambia
  onScoreChange?: (score: number) => void;
  // 1v1: notifica quando cambiano le vite rimaste della propria navicella (per l'HUD).
  onLivesChange?: (lives: number) => void;
  // 1v1: notifica quando la partita si chiude (esito comunicato dal server dell'arena - vedi
  // MatchResult sotto). La UI puo' usarla per riabilitare i controlli o mostrare un riepilogo fuori
  // dal canvas; il testbed la usa per chiudere il run. Il punteggio finale/vincitore viene comunque
  // gia' disegnato direttamente sul canvas dal motore.
  onMatchEnd?: (result: MatchResult) => void;
  // 1v1: notifica periodica del tempo rimanente di partita in ms (letto da ArenaSnapshot.remainingMs),
  // per un countdown nell'HUD fuori dal canvas.
  onTimeRemaining?: (msRemaining: number) => void;
  //  Regole di partita da applicare (vedi MatchMode sotto). Se assente: "timed", cioe' la partita
  // manuale di sempre.
  matchMode?: MatchMode;
  //  TESTBED: chiamata all'inizio di ogni frame simulato (solo per il proprio input locale: il
  // frame dell'arena condivisa e' ormai contato dal server, vedi ArenaMatchResult.endFrame), con
  // il numero del frame (0 = primo frame della partita). Il testbed la usa per inviare gli input
  // scriptati esattamente al frame previsto (vedi testbed/scenarioPlayer.ts).
  onBeforeFrame?: (frame: number) => void;
};

// Riesporta il tipo di configurazione dell'arena usato dal messaggio di join (vedi
// arena/arenaClient.ts) per comodita' di chi costruisce uno scenario - stessa forma di
// GameDifficultyConfig sopra, qui non tipizzata nel dettaglio a livello di trasporto.
export type { ArenaGameConfig };

//  Regole di fine partita supportate dal motore:
// - "timed": partita manuale 1v1 (timer, vite con respawn, allo scadere vince chi ha piu' punti);
// - "testbed": partita automatica del testbed (una sola vita per navicella, nessun timer). Chi
//   viene eliminato resta fuori gioco e l'altro continua; la partita si chiude quando entrambi
//   sono stati eliminati o quando l'ultima ondata scriptata risulta eliminata da un po'.
// In ENTRAMBI i casi la regola e' applicata e fatta rispettare dal server dell'arena (vedi
// arena-server/simulation.js): il client si limita a mostrarne l'esito.
export type MatchMode = "timed" | "testbed";

// Esito della partita dal punto di vista del giocatore LOCALE.
export type MatchOutcome = "win" | "lose" | "draw";

// Testo mostrato a fine partita nel testbed per ciascun esito (vedi LocalGameEngine).
export const MATCH_OUTCOME_LABEL: Record<MatchOutcome, string> = {
  win: "YOU WIN",
  lose: "GAME OVER",
  draw: "DRAW",
};

// Perche' la partita si e' chiusa.
// - "timeUp": timer scaduto (solo partita manuale);
// - "bothEliminated": entrambe le navicelle eliminate (testbed);
// - "lastWaveCleared": ultima ondata scriptata eliminata e trascorso il ritardo finale (testbed).
export type MatchEndReason = "timeUp" | "bothEliminated" | "lastWaveCleared";

// Criterio con cui e' stato deciso l'esito.
// - "eliminationOrder": entrambi eliminati, perde chi e' stato eliminato per primo;
// - "survival": uno solo sopravvissuto, vince lui indipendentemente dai punti;
// - "score": nessuno eliminato (o partita manuale), vince chi ha piu' punti.
export type MatchDecidedBy = "eliminationOrder" | "survival" | "score";

//  Riepilogo della partita passato a onMatchEnd - la stessa informazione arriva GIA' calcolata dal
// server dell'arena (vedi ArenaMatchResult in arena/arenaClient.ts, identica per costruzione sui
// due client): questo tipo esiste solo per riformattarla dal punto di vista del giocatore LOCALE
// (localScore/remoteScore invece di un elenco players[]), comodo per il disegno a schermo e per il
// report del testbed - vedi mapArenaResultToMatchResult() in LocalGameEngine.ts.
export type MatchResult = {
  mode: MatchMode;
  outcome: MatchOutcome;
  endReason: MatchEndReason;
  decidedBy: MatchDecidedBy;
  localScore: number;
  remoteScore: number;
  localEliminated: boolean;
  remoteEliminated: boolean;
  localEliminatedAtFrame: number | null;
  remoteEliminatedAtFrame: number | null;
  // Primo frame in cui l'ultima ondata scriptata risultava eliminata - null se non e' mai successo
  // (vedi ArenaMatchResult.lastWaveClearedAtFrame, gia' calcolato dal server).
  lastWaveClearedAtFrame: number | null;
  // Frame del server (arena-server/simulation.js, scriptedClock) in cui la partita si e' fermata.
  endFrame: number;
  finalPositionX: number;
  finalPositionY: number;
};

//Vec2 è un tipo che rappresenta un vettore a due dimensioni, usato per posizioni e velocità
export type Vec2 = {
  x: number;
  y: number;
};

//RestartButton rappresenta le proprietà di un pulsante di riavvio visualizzato quando il gioco è finito
export type RestartButton = {
  x: number;
  y: number;
  width: number;
  height: number;
};

//KeyState tiene traccia dello stato di pressione dei tasti WASD e spazio, usati per controllare il giocatore
export type KeysState = {
  a: { pressed: boolean };
  d: { pressed: boolean };
  w: { pressed: boolean };
  s: { pressed: boolean };
  space: { pressed: boolean };
};

// 1v1 - server autoritativo: GameFlags tiene traccia SOLO dello stato della PROPRIA navicella, non
// piu' della partita nel suo complesso (il timer/l'esito sono decisi dal server, vedi
// ArenaSnapshot/ArenaMatchResult) - "active" e' stato rimosso: il motore resta sempre "attivo" fino
// a un vero e proprio matchEnd dal server.
export type GameFlags = {
  // true nel breve intervallo tra un colpo subito e il respawn: navicella nascosta, non
  // pilotabile. Puramente cosmetico (vedi config.ts): la vulnerabilita' reale ai fini delle
  // collisioni resta decisa dal server.
  respawning: boolean;
  // true quando il server segnala che le vite di questa navicella sono a 0 (ArenaSnapshot.
  // players[username].eliminated): resta fuori gioco per il resto della partita (non pilotabile),
  // ma il motore continua a disegnare l'arena condivisa e la navicella avversaria fino al matchEnd.
  eliminated: boolean;
};

// Usata da LocalGameEngine per leggere/mostrare l'esito ArenaMatchResult direttamente (vedi
// mapArenaResultToMatchResult()), evitando una dipendenza circolare tra questo file e
// arena/arenaClient.ts nel verso opposto.
export type { ArenaMatchResult };
