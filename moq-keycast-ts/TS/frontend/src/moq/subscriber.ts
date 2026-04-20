//Il publisher invia gli snapshot del gioco e il subscriber li riceve così da poter aggiornare lo stato del gioco dei giocatori remoti.
// Il subscriber si occupa anche di tenere traccia degli utenti presenti nella room, così da poter mostrare una lista dei giocatori
// connessi, o gestire una lobby di attesa prima dell'inizio del gioco.
// Quando arriva un aggiornamento chiama onGameUpdate, che aggiorna lo stato del gioco del giocatore remoto.
// Quando un utente si connette o disconnette, chiama onPresenceUpdate.

import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME, TRACK_PRIORITY } from "../config";
import { connectToRelay, type MoqConnection } from "./connection";
import type { GameSnapshot } from "./publisher";

let abortController: AbortController | null = null;

// Mantengo una piccola lista degli utenti remoti presenti nella room,
// utile per lobby / waiting room / gestione presenza.
let remoteUsers: string[] = [];

// Metriche raccolte per ogni utente remoto.
type RemoteMetrics = {
  lastSeq: number | null;
  receivedPackets: number;
  lostPackets: number;
  lastLatency: number | null;
  jitter: number;
  totalLatency: number;
  latencySamples: number;
};

const metricsByUser = new Map<string, RemoteMetrics>();

function createInitialMetrics(): RemoteMetrics {
  return {
    lastSeq: null,
    receivedPackets: 0,
    lostPackets: 0,
    lastLatency: null,
    jitter: 0,
    totalLatency: 0,
    latencySamples: 0,
  };
}

export async function startSubscriber(
  room: string,
  username: string,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  const connection = await connectToRelay();

  // Creo un nuovo AbortController per poter interrompere la lettura degli aggiornamenti quando l'utente lascia la room,
  // o quando c'è un errore di connessione.
  abortController = new AbortController();
  const { signal } = abortController;

  remoteUsers = [];
  metricsByUser.clear();

  // Notifico subito la presenza degli utenti, che sarà vuota all'inizio.
  onPresenceUpdate?.([...remoteUsers]);

  const roomPrefix = Moq.Path.from(`${APP_PREFIX}/${room}/`);
  const announced = connection.announced(roomPrefix);

  // Avvio la lettura degli annunci di nuovi publisher nella room.
  void watchAnnouncements(
    connection,
    announced,
    username,
    signal,
    onGameUpdate,
    onPresenceUpdate,
  );
}

export function stopSubscriber(): void {
  abortController?.abort();
  abortController = null;
  remoteUsers = [];
  metricsByUser.clear();
}

// Questa funzione si occupa di ascoltare gli annunci dei publisher nella room, così da poter sottoscrivere i loro track di gioco e
// ricevere gli aggiornamenti. Quando un publisher si disconnette, interrompe la lettura dei suoi track e aggiorna la lista degli utenti remoti.
async function watchAnnouncements(
  connection: MoqConnection,
  announced: Moq.Announced,
  localUsername: string,
  signal: AbortSignal,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  const userControllers = new Map<string, AbortController>();

  for (;;) {
    if (signal.aborted) break;

    const entry = await announced.next();
    if (!entry) break;

    const pathStr = entry.path.toString();
    const remoteUsername = pathStr.split("/").at(-1) ?? "";

    if (!remoteUsername || remoteUsername === localUsername) continue;

    // Se il publisher è attivo, sottoscrivo i suoi track di gioco.
    // Altrimenti, interrompo la lettura dei suoi track e aggiorno la lista degli utenti remoti.
    if (entry.active) {
      userControllers.get(remoteUsername)?.abort();

      const ctrl = new AbortController();
      userControllers.set(remoteUsername, ctrl);

      ensureRemoteUser(remoteUsername);
      metricsByUser.set(remoteUsername, createInitialMetrics());
      onPresenceUpdate?.([...remoteUsers]);

      const remoteBroadcast = connection.consume(entry.path);
      const gameTrack = remoteBroadcast.subscribe(TRACK_GAME, TRACK_PRIORITY);

      // Avvio la lettura del track di gioco del publisher remoto.
      void readGameTrack(
        gameTrack,
        remoteUsername,
        ctrl.signal,
        onGameUpdate,
        onPresenceUpdate,
      );
    } else {
      // Se il publisher si disconnette, interrompo la lettura dei suoi track e aggiorno la lista degli utenti remoti.
      userControllers.get(remoteUsername)?.abort();
      userControllers.delete(remoteUsername);

      remoteUsers = remoteUsers.filter((u) => u !== remoteUsername);
      metricsByUser.delete(remoteUsername);
      onPresenceUpdate?.([...remoteUsers]);
    }
  }

  // Quando il subscriber si ferma, interrompe la lettura di tutti i track dei publisher remoti.
  for (const ctrl of userControllers.values()) {
    ctrl.abort();
  }
}

// Questa funzione si occupa di leggere i track di gioco dei publisher remoti, così da poter ricevere gli aggiornamenti del loro stato di gioco.
async function readGameTrack(
  track: Moq.Track,
  username: string,
  signal: AbortSignal,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  // Leggo i gruppi di aggiornamenti dal track di gioco del publisher remoto in un ciclo infinito,
  // fino a quando il segnale di interruzione non viene attivato.
  for (;;) {
    if (signal.aborted) break;

    const group = await track.nextGroup();
    if (!group) {
      remoteUsers = remoteUsers.filter((u) => u !== username);
      metricsByUser.delete(username);
      onPresenceUpdate?.([...remoteUsers]);
      break;
    }

    const payload = (await group.readJson()) as GameSnapshot | undefined;
    if (!payload) continue;

    ensureRemoteUser(username);

    // Aggiorno le metriche prima di passare lo snapshot al gioco.
    updateMetrics(username, payload);

    onGameUpdate(username, payload);
  }
}

// Aggiorna le metriche di rete per uno specifico utente remoto.
function updateMetrics(username: string, snapshot: GameSnapshot): void {
  const metrics = metricsByUser.get(username) ?? createInitialMetrics();

  const now = Date.now();
  const latency = now - snapshot.sentAt;

  metrics.receivedPackets += 1;
  metrics.totalLatency += latency;
  metrics.latencySamples += 1;

  // Jitter = variazione della latenza rispetto al pacchetto precedente.
  if (metrics.lastLatency !== null) {
    metrics.jitter = Math.abs(latency - metrics.lastLatency);
  }
  metrics.lastLatency = latency;

  // Packet loss logico: se la sequenza salta, vuol dire che uno o più aggiornamenti non sono arrivati.
  if (metrics.lastSeq !== null && snapshot.seq > metrics.lastSeq + 1) {
    metrics.lostPackets += snapshot.seq - metrics.lastSeq - 1;
  }
  metrics.lastSeq = snapshot.seq;

  metricsByUser.set(username, metrics);

  const avgLatency =
    metrics.latencySamples > 0
      ? metrics.totalLatency / metrics.latencySamples
      : 0;

  const totalExpectedPackets = metrics.receivedPackets + metrics.lostPackets;
  const lossRate =
    totalExpectedPackets > 0
      ? (metrics.lostPackets / totalExpectedPackets) * 100
      : 0;

  console.log(`[Metrics][${username}]`, {
    latencyMs: latency,
    jitterMs: metrics.jitter,
    avgLatencyMs: Number(avgLatency.toFixed(2)),
    receivedPackets: metrics.receivedPackets,
    lostPackets: metrics.lostPackets,
    lossRatePercent: Number(lossRate.toFixed(2)),
  });
}

function ensureRemoteUser(username: string): string {
  const existing = remoteUsers.find((u) => u === username);

  if (existing) return existing;

  remoteUsers.push(username);
  return username;
}