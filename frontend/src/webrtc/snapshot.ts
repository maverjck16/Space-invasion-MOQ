// Tipi dello stato di gioco trasferito in rete. Identici 1:1 alla versione MoQ
// (erano definiti in moq/publisher.ts): il payload applicativo non cambia tra le due
// implementazioni, cambia solo il trasporto (vedi src/webrtc/peerManager.ts).
//
// 1v1: rispetto alla versione "a specchio" precedente, il campo di gioco (griglie di invasori,
// asteroidi, proiettili nemici) NON viaggia piu' in rete. I due client lo simulano in locale in modo
// IDENTICO (stesso seed deterministico, stesso numero di frame dallo stesso istante di partenza
// condiviso - vedi testbed/rng.ts e l'handshake in main.ts), quindi trasmetterlo sarebbe ridondante.
// Resta in rete solo cio' che e' realmente diverso da client a client: la propria navicella, i
// propri proiettili, punteggio/vite, e un piccolo elenco di id di entita' del campo condiviso
// eliminate dai propri colpi (killedIds), cosi' l'altro client puo' rimuoverle dalla propria copia
// locale del campo e non doppio-contarle. Vedi LocalGameEngine.ts per come viene usato tutto questo.
export type Vec2 = {
  x: number;
  y: number;
};

export type PlayerSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  rotation: number;
  opacity: number;
};

export type ProjectileSnapshot = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

// 1v1: mandato una sola volta, dal lato che genera l'handshake (vedi main.ts) al momento in cui
// rileva il peer gia' presente - installa lo stesso seed deterministico e lo stesso istante di
// partenza su entrambi i client, cosi' le due simulazioni locali del campo condiviso restano
// identiche. Assente in tutti gli altri snapshot (undefined).
export type MatchInit = {
  seed: number;
  // Istante di partenza condiviso, in Date.now() (non performance.now(): deve essere confrontabile
  // tra le due macchine) - qualche centinaio di ms nel futuro rispetto a quando viene generato, per
  // dare tempo al messaggio di arrivare prima che scada.
  startAtEpochMs: number;
};

export type GameSnapshot = {
  tick: number;
  player: PlayerSnapshot;
  projectiles: ProjectileSnapshot[];
  score: number;
  // 1v1: vite rimaste alla propria navicella (vedi config.LIVES_PER_PLAYER per il valore iniziale).
  lives: number;
  gameOver: boolean;
  gameActive: boolean;
  // 1v1: id delle entita' del campo condiviso (invasori/asteroidi) eliminate da un proprio colpo
  // dall'ultimo snapshot inviato. Vuoto/assente quando non c'e' nulla da riconciliare.
  killedIds?: string[];
  // 1v1: presente solo nel messaggio di handshake iniziale, vedi MatchInit sopra.
  matchInit?: MatchInit;
};

// Snapshot "vuoto" inviato subito all'apertura di un DataChannel, cosi' il peer ha
// subito qualcosa da renderizzare prima ancora del primo tick di rete (equivalente
// del primo gruppo scritto da serveTrackRequests() nella versione MoQ).
export function createEmptySnapshot(): GameSnapshot {
  return {
    tick: 0,
    player: {
      x: 0,
      y: 0,
      width: 60,
      height: 60,
      vx: 0,
      vy: 0,
      rotation: 0,
      opacity: 1,
    },
    projectiles: [],
    score: 0,
    lives: 0,
    gameOver: false,
    gameActive: true,
  };
}
