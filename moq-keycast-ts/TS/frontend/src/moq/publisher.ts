//  Questo file contiene la logica del publisher, che si occupa di pubblicare lo stato di gioco del giocatore locale ai subscriber
//  connessi alla stessa room.
import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME } from "../config";
import { connectToRelay } from "./connection";

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
  seq: number;
  sentAt: number;
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

// Contatore progressivo degli snapshot inviati.
// Serve al subscriber per capire se qualche aggiornamento è andato perso.
let snapshotSequence = 0;

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

  // Resetto il contatore quando parte una nuova sessione di publishing.
  snapshotSequence = 0;

  void serveTrackRequests(broadcast);
}

export function stopPublisher(): void {
  if (!broadcast) return;

  broadcast.close();
  broadcast = null;
  activeGameTracks.clear();

  // Opzionale ma utile: quando il publisher si ferma, azzero anche la sequenza.
  snapshotSequence = 0;
}

//  Questa funzione si occupa di pubblicare un nuovo snapshot di gioco sui track di gioco attivi, scrivendo il suo contenuto
// come JSON in un nuovo gruppo di ogni track.
// Prima di inviarlo, aggiunge:
// - seq: numero progressivo dello snapshot
// - sentAt: timestamp di invio
export function publishSnapshot(snapshot: GameSnapshot): void {
  if (activeGameTracks.size === 0) return;

  const measuredSnapshot: GameSnapshot = {
    ...snapshot, // Copio tutte le proprietà dello snapshot originale
    seq: snapshotSequence++, //assegna il numero corrente e incrementa il contatore per il prossimo snapshot, serve per rilevare pacchetti diversi
    sentAt: Date.now(), //salva il timestamp, esatto momento in cui invio lo snapshot
  };

  for (const track of activeGameTracks) {
    try {
      const group = track.appendGroup();
      group.writeJson(measuredSnapshot);
      group.close();
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

    const firstGroup = track.appendGroup();
    firstGroup.writeJson(createEmptySnapshot());
    firstGroup.close();

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
    seq: 0,
    sentAt: Date.now(),
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