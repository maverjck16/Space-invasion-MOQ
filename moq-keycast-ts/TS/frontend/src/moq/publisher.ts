import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME } from "../config";
import { connectToRelay } from "./connection";

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

let broadcast: Moq.Broadcast | null = null;
const activeGameTracks = new Set<Moq.Track>();

export async function startPublisher(
  room: string,
  username: string,
): Promise<void> {
  const connection = await connectToRelay();

  const path = Moq.Path.from(`${APP_PREFIX}/${room}/${username}`);

  broadcast = new Moq.Broadcast();
  connection.publish(path, broadcast);

  void serveTrackRequests(broadcast);
}

export function stopPublisher(): void {
  if (!broadcast) return;

  broadcast.close();
  broadcast = null;
  activeGameTracks.clear();
}

export function publishSnapshot(snapshot: GameSnapshot): void {
  if (activeGameTracks.size === 0) return;

  for (const track of activeGameTracks) {
    try {
      const group = track.appendGroup();
      group.writeJson(snapshot);
      group.close();
    } catch (err) {
      console.warn("[Publisher] Errore track game:", err);
      activeGameTracks.delete(track);
    }
  }
}

async function serveTrackRequests(broadcast: Moq.Broadcast): Promise<void> {
  for (;;) {
    const request = await broadcast.requested();
    if (!request) return;

    const { track } = request;

    if (track.name !== TRACK_GAME) {
      track.close(new Error(`Track non supportata: ${track.name}`));
      continue;
    }

    activeGameTracks.add(track);

    const firstGroup = track.appendGroup();
    firstGroup.writeJson(createEmptySnapshot());
    firstGroup.close();

    track.closed.then(() => {
      activeGameTracks.delete(track);
    });
  }
}

function createEmptySnapshot(): GameSnapshot {
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