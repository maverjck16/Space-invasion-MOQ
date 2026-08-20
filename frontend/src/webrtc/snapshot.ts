// Tipi dello stato di gioco trasferito in rete. Identici 1:1 alla versione MoQ
// (erano definiti in moq/publisher.ts): il payload applicativo non cambia tra le due
// implementazioni, cambia solo il trasporto (vedi src/webrtc/peerManager.ts).
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

export type InvaderProjectileSnapshot = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
};

export type InvaderSnapshot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GridSnapshot = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  invaders: InvaderSnapshot[];
};

export type ParticleSnapshot = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  opacity: number;
  fades: boolean;
};

export type AsteroidSnapshot = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  health: number;
  maxHealth: number;
  points: number[];
};

export type GameSnapshot = {
  tick: number;
  player: PlayerSnapshot;
  projectiles: ProjectileSnapshot[];
  invaderProjectiles: InvaderProjectileSnapshot[];
  grids: GridSnapshot[];
  particles: ParticleSnapshot[];
  asteroids: AsteroidSnapshot[];
  score: number;
  gameOver: boolean;
  gameActive: boolean;
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
    invaderProjectiles: [],
    grids: [],
    particles: [],
    asteroids: [],
    score: 0,
    gameOver: false,
    gameActive: true,
  };
}
