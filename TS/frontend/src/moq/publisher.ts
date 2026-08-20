//  Questo file contiene la logica del publisher, che si occupa di pubblicare lo stato di gioco del giocatore locale ai subscriber
//  connessi alla stessa room.
import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME } from "../config";
import { connectToRelay } from "./connection";
import {
  nextOutgoingSeq,
  consumePendingEcho,
  recordSent,
  type NetEnvelope,
} from "../metrics/metrics";

//esporta tutti i tipi di snapshot del gioco, che vengono usati sia dal publisher che dal subscriber.
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

const textEncoder = new TextEncoder();

//  Costruisce l'envelope di rete (seq/timestamp/eco per le metriche, vedi src/metrics/metrics.ts)
// attorno a un GameSnapshot e lo serializza una sola volta, cosi' i byte codificati possono essere
// riusati (senza ri-serializzare) per ogni track sottoscritta.
function buildEnvelope(payload: GameSnapshot): { envelope: NetEnvelope; bytes: Uint8Array } {
  const echo = consumePendingEcho();

  const envelope: NetEnvelope = {
    v: 1,
    seq: nextOutgoingSeq(),
    tSent: performance.now(),
    echoSeq: echo?.seq,
    echoTSent: echo?.tSent,
    payload,
  };

  const bytes = textEncoder.encode(JSON.stringify(envelope));
  return { envelope, bytes };
}

//  Questa funzione si occupa di avviare il publisher, creando un nuovo broadcast e pubblicandolo sulla relay con un path specifico 
// per la room e il nome utente. Inoltre, avvia la funzione serveTrackRequests per gestire le richieste di sottoscrizione 
// ai track di gioco da parte dei subscriber.
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

//  Questa funzione si occupa di pubblicare un nuovo snapshot di gioco sui track di gioco attivi, scrivendo il suo contenuto
// come JSON (avvolto in un envelope con seq/timestamp per le metriche) in un nuovo gruppo di ogni track.
export function publishSnapshot(snapshot: GameSnapshot): void {
  if (activeGameTracks.size === 0) return;

  const { envelope, bytes } = buildEnvelope(snapshot);

  for (const track of activeGameTracks) {
    try {
      const group = track.appendGroup();
      group.writeFrame(bytes);
      group.close();
      recordSent(envelope.seq, bytes.byteLength);
    } catch (err) {
      console.warn("[Publisher] Errore track game:", err);
      activeGameTracks.delete(track);
    }
  }
}

//  Questa funzione si occupa di gestire le richieste di sottoscrizione ai track di gioco da parte dei subscriber, leggendo i
//  messaggi di richiesta dal broadcast e avviando la lettura dei track di gioco dei publisher remoti quando arrivano nuove richieste.
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

    const { envelope, bytes } = buildEnvelope(createEmptySnapshot());
    const firstGroup = track.appendGroup();
    firstGroup.writeFrame(bytes);
    firstGroup.close();
    recordSent(envelope.seq, bytes.byteLength);

    track.closed.then(() => {
      activeGameTracks.delete(track);
    });
  }
}

//  Questa funzione crea uno snapshot di gioco vuoto, con valori di default per tutte le proprietà. Viene usata quando un nuovo 
// subscriber si connette, per inviargli subito uno snapshot iniziale così da poter mostrare lo stato di gioco anche prima di 
// ricevere i primi aggiornamenti.
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