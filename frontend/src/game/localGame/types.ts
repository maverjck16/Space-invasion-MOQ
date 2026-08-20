import type { GameSnapshot } from "../../webrtc/snapshot";
import type { Invader } from "./entities/Invader";

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
};

//definisco i tipi per le entità di gioco e le loro proprietà, così come le opzioni per inizializzare il gioco locale
export type LocalGameOptions = {
  canvas: HTMLCanvasElement;
  //funzione di callback per inviare snapshot del gioco al publisher
  onSnapshot: (snapshot: GameSnapshot) => void;
  //funzione di callback opzionale per notificare il publisher quando il punteggio cambia
  onScoreChange?: (score: number) => void;
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

//GameFlags tiene traccia dello stato del gioco, se è finito o attivo
export type GameFlags = {
  over: boolean;
  active: boolean;
};

//i tipi "Like" rappresentano le proprietà  delle entità di gioco che vengono incluse negli snapshot inviati al publisher per tenere
//traccia dello stato del gioco lato server e sincronizzare i client connessi
export type ProjectileLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
};

export type InvaderProjectileLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
};

export type ParticleLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  color: string;
  opacity: number;
  fades: boolean;
};

export type InvaderLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
};

export type GridLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  invaders: Invader[];
};

export type AsteroidLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  health: number;
  maxHealth: number;
  points: number[];
};
