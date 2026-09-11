import type { GameSnapshot } from "../../webrtc/snapshot";

//  TESTBED: parametri di difficolta'/carico opzionali (vedi src/testbed/scenario.types.ts,
// campo "gameConfig"). OPZIONALI: se assenti (gioco manuale originale, o testbed senza scenario)
// il motore usa esattamente gli stessi valori hardcoded di sempre - vedi i default in
// LocalGameEngine.ts e Grid.ts. Nessun impatto sul comportamento fuori dalla modalita' Testbed.
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
  // TESTBED: tetto opzionale al numero di asteroidi generati in tutta la partita (oltre questo
  // numero lo spawn si ferma, anche se l'intervallo scadrebbe di nuovo) - utile per scenari dove si
  // vuole un pericolo iniziale ben preciso e controllato, senza che la partita continui a generarne
  // altri se il giocatore sopravvive piu' a lungo del previsto. Se assente, nessun limite (comportamento
  // di sempre).
  asteroidMaxCount?: number;
  // TESTBED: ondate di griglie "scriptate" (dimensione e capacita' di sparo esatte, invece che
  // scelte a caso in un intervallo) usate al posto dello spawner casuale (gridSpawnIntervalFrames*)
  // quando presenti e non vuote - vedi ScriptedWave sotto e LocalGameEngine.animate(). OPZIONALE:
  // se assente/vuoto il motore usa lo spawner casuale di sempre, nessun impatto sul gioco manuale.
  scriptedWaves?: ScriptedWave[];
  // TESTBED: asteroidi "scriptati" (istante esatto invece che intervallo casuale), indipendenti
  // dallo spawner casuale di asteroidi (asteroidSpawnIntervalFrames*/asteroidsEnabled, che restano
  // invariati e possono restare disattivati quando si usa questo). OPZIONALE.
  scriptedAsteroids?: ScriptedAsteroidEvent[];
};

// TESTBED: una singola ondata scriptata. Spawna non appena (a) tutte le ondate precedenti sono
// state completamente distrutte (this.grids.length === 0) E (b) sono trascorsi almeno
// "minStartFrame" frame dall'inizio della partita (contati con un contatore dedicato che, a
// differenza di "this.frames", non si azzera mai - vedi LocalGameEngine.scriptedClock) - cosi' si
// puo' scriptare sia "aspetta che il giocatore liberi il campo prima di continuare" sia "non prima
// di X secondi dall'inizio" (es. per una fase iniziale senza nemici), anche insieme.
export type ScriptedWave = {
  minStartFrame: number;
  columns: number;
  rows: number;
  // Se false, nessun invasore di questa ondata sparera' mai (vedi Grid.canShoot e il ciclo di
  // sparo in LocalGameEngine.animate()) - a differenza di asteroidsEnabled/gridSpawnInterval*, che
  // sono globali per tutto lo scenario, questo si applica ondata per ondata.
  canShoot: boolean;
  // Se true, un asteroide (mirato alla posizione del giocatore in quell'istante, stessa logica
  // dello spawner casuale) viene generato nello stesso momento in cui questa ondata spawna.
  spawnAsteroid?: boolean;
};

// TESTBED: un asteroide scriptato "a se stante" (non legato allo spawn di un'ondata) - usato ad
// es. per una fase iniziale senza nemici che comunque deve contenere un asteroide.
export type ScriptedAsteroidEvent = {
  minStartFrame: number;
};

//definisco i tipi per le entità di gioco e le loro proprietà, così come le opzioni per inizializzare il gioco locale
export type LocalGameOptions = {
  canvas: HTMLCanvasElement;
  //funzione di callback per inviare snapshot del gioco al publisher
  onSnapshot: (snapshot: GameSnapshot) => void;
  //funzione di callback opzionale per notificare il publisher quando il punteggio cambia
  onScoreChange?: (score: number) => void;
  // 1v1: notifica quando cambiano le vite rimaste della propria navicella (per l'HUD).
  onLivesChange?: (lives: number) => void;
  // 1v1: notifica quando il timer di partita raggiunge lo zero e il motore si ferma - la UI puo'
  // usarla per riabilitare i controlli (es. tasto ESCI) o mostrare un riepilogo fuori dal canvas.
  // Il punteggio finale/vincitore viene comunque gia' disegnato direttamente sul canvas dal motore.
  onMatchEnd?: () => void;
  // 1v1: notifica periodica del tempo rimanente di partita in ms, per un countdown nell'HUD fuori
  // dal canvas (il countdown "grosso" e' comunque disegnato anche a canvas, questa e' per badge/testo
  // esterni se servono).
  onTimeRemaining?: (msRemaining: number) => void;
  //  TESTBED: configurazione di difficolta'/carico opzionale per questo scenario (vedi sopra).
  gameConfig?: GameDifficultyConfig;
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

// 1v1: GameFlags tiene traccia dello stato della PROPRIA navicella e della partita nel suo
// complesso (ridefinito rispetto alla versione a singolo giocatore: non c'e' piu' un game over
// immediato al primo colpo, vedi LocalGameEngine.playerDeath()).
export type GameFlags = {
  // true nel breve intervallo tra un colpo subito e il respawn: navicella nascosta, non
  // pilotabile, non collidibile.
  respawning: boolean;
  // true quando le vite della propria navicella sono a 0: resta fuori gioco per il resto della
  // partita (non pilotabile/non collidibile), ma il motore/arena condivisa continuano a girare
  // per l'altro giocatore fino allo scadere del timer.
  eliminated: boolean;
  // true finche' il timer di partita non e' scaduto: quando passa a false il motore si ferma e
  // viene mostrata la schermata finale con i due punteggi.
  active: boolean;
};

// 1v1: i vecchi tipi "*Like" (ProjectileLike/InvaderProjectileLike/ParticleLike/InvaderLike/
// GridLike/AsteroidLike) sono stati rimossi: servivano solo a ombreggiare la forma delle entita'
// nello snapshot di rete, che ora non porta piu' griglie/asteroidi/proiettili nemici/particelle
// (vedi webrtc/snapshot.ts) - il campo condiviso viaggia solo come stato interno del motore.
