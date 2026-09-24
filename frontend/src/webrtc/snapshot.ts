// Tipi dello stato di gioco trasferito PEER-TO-PEER (canale "game", vedi webrtc/peerManager.ts).
// Identici 1:1 alla versione MoQ (erano definiti in moq/publisher.ts): il payload applicativo non
// cambia tra le due implementazioni, cambia solo il trasporto.
//
// 1v1 - server autoritativo: da quando l'arena condivisa (invasori/asteroidi/proiettili nemici,
// punteggio, vite, fine partita) e' decisa da un server dedicato (vedi arena-server/server.js e
// src/arena/arenaClient.ts), questo canale P2P non porta piu' NESSUNO di quei dati: non li ha mai
// avuti per intero (nella versione a "doppia simulazione locale" restava comunque implicito nel
// fatto che i due client dovessero eseguire la STESSA simulazione), ma portava ancora punteggio,
// vite, stato di fine partita e gli id delle entita' eliminate (killedIds) per farli concordare.
// Con un'unica autorita' condivisa questi campi sono ridondanti: il client legge punteggio/vite/
// esito direttamente dagli ArenaSnapshot/ArenaMatchResult del server (identici per entrambi, per
// costruzione, non c'e' piu' nulla da riconciliare tra i due lati).
//
// Cio' che resta su questo canale e' quindi solo cio' che serve a un rendering fluido e a bassa
// latenza della navicella avversaria: la sua posizione/rotazione/opacita' e i suoi proiettili in
// volo, aggiornati piu' spesso (NETWORK_TICK_HZ, vedi config.ts) di quanto l'arena venga
// ribroadcast (vedi arena-server/server.js, BROADCAST_HZ) - un dato puramente cosmetico che non
// decide mai punteggio o collisioni: quelle le decide solo il server, sulla base della posizione
// che ciascun client gli manda direttamente (vedi arenaClient.sendState()).
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

export type GameSnapshot = {
  tick: number;
  player: PlayerSnapshot;
  projectiles: ProjectileSnapshot[];
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
  };
}
