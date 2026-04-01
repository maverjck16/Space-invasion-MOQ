//Il publisher invia gli snapshot del gioco e il subscriber gli riceve così da poter aggiornare lo stato del gioco dei giocatori remoti. 
// Il subscriber si occupa anche di tenere traccia degli utenti presenti nella room, così da poter mostrare una lista dei giocatori 
// connessi, o gestire una lobby di attesa prima dell'inizio del gioco.
//Quando arriva un aggiornamento chiama onGameUpdate, che aggiorna lo stato del gioco del giocatore remoto.
//  Quando un utente si connette o disconnette, chiama onPresenceUpdate,

import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME, TRACK_PRIORITY } from "../config";
import { connectToRelay, type MoqConnection } from "./connection";
import type { GameSnapshot } from "./publisher";

let abortController: AbortController | null = null;

//  Mantengo una piccola mappa degli utenti remoti presenti nella room,
// utile più avanti per lobby / waiting room / gestione presenza.
let remoteUsers: string[] = [];

export async function startSubscriber(
  room: string,
  username: string,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  const connection = await connectToRelay();

  //  Creo un nuovo AbortController per poter interrompere la lettura degli aggiornamenti quando l'utente lascia la room, 
  // o quando c'è un errore di connessione.
  abortController = new AbortController();
  const { signal } = abortController;

  remoteUsers = [];
  //  Notifico subito la presenza degli utenti (che sarà vuota all'inizio) così da poter mostrare una lista aggiornata dei giocatori 
  // connessi.
  onPresenceUpdate?.([...remoteUsers]);

  const roomPrefix = Moq.Path.from(`${APP_PREFIX}/${room}/`);
  const announced = connection.announced(roomPrefix);

  //  Avvio la lettura degli annunci di nuovi publisher nella room, così da poter sottoscrivere i loro track di gioco e ricevere 
  // gli aggiornamenti.
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
}

//  Questa funzione si occupa di ascoltare gli annunci dei publisher nella room, così da poter sottoscrivere i loro track di gioco e 
// ricevere gli aggiornamenti. Quando un publisher si disconnette, interrompe la lettura dei suoi track e aggiorna la lista degli utenti
//  remoti.
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

    //  Se il publisher è attivo, sottoscrivo i suoi track di gioco. Altrimenti, interrompo la lettura dei suoi track e aggiorno la 
    // lista degli utenti remoti.
    if (entry.active) {
      userControllers.get(remoteUsername)?.abort();

      const ctrl = new AbortController();
      userControllers.set(remoteUsername, ctrl);

      //  Notifico la presenza del nuovo utente così da poter aggiornare la lista dei giocatori connessi. 
      //  La funzione ensureRemoteUser aggiunge l'utente alla lista se non è già presente, e restituisce il nome utente.
      ensureRemoteUser(remoteUsername);
      onPresenceUpdate?.([...remoteUsers]);

      const remoteBroadcast = connection.consume(entry.path);
      const gameTrack = remoteBroadcast.subscribe(TRACK_GAME, TRACK_PRIORITY);

      //  Avvio la lettura dei track di gioco del publisher remoto, così da poter ricevere gli aggiornamenti del suo stato di gioco.
      //la funzione riceve il track di gioco del publisher remoto, il nome utente del publisher, un segnale di interruzione, e le 
      // callback per gli aggiornamenti di gioco e presenza.
      void readGameTrack(
        gameTrack,
        remoteUsername,
        ctrl.signal,
        onGameUpdate,
        onPresenceUpdate,
      );
    } else {
      //  Se il publisher si disconnette, interrompo la lettura dei suoi track e aggiorno la lista degli utenti remoti.
      userControllers.get(remoteUsername)?.abort();
      userControllers.delete(remoteUsername);

      remoteUsers = remoteUsers.filter((u) => u !== remoteUsername);
      onPresenceUpdate?.([...remoteUsers]);
    }
  }
//  Quando il subscriber si ferma, interrompe la lettura di tutti i track dei publisher remoti e svuota la lista degli utenti.
  for (const ctrl of userControllers.values()) {
    ctrl.abort();
  }
}

//  Questa funzione si occupa di leggere i track di gioco dei publisher remoti, così da poter ricevere gli aggiornamenti del loro 
// stato di gioco.
async function readGameTrack(
  track: Moq.Track,
  username: string,
  signal: AbortSignal,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  //  Leggo i gruppi di aggiornamenti dal track di gioco del publisher remoto in un ciclo infinito, fino a quando il segnale di
  //  interruzione non viene attivato. Quando arriva un nuovo gruppo, leggo il suo contenuto come JSON e lo passo alla callback di 
  // aggiornamento di gioco, insieme al nome utente del publisher remoto. Se il gruppo è vuoto o non contiene un JSON valido, lo 
  // ignoro e continuo a leggere i successivi.
  for (;;) {
    if (signal.aborted) break;

    const group = await track.nextGroup();
    if (!group) {
      remoteUsers = remoteUsers.filter((u) => u !== username);
      onPresenceUpdate?.([...remoteUsers]);
      break;
    }

    const payload = (await group.readJson()) as GameSnapshot | undefined;
    if (!payload) continue;

    ensureRemoteUser(username);
    onGameUpdate(username, payload);
  }
}

function ensureRemoteUser(username: string): string {
  const existing = remoteUsers.find((u) => u === username);

  if (existing) return existing;

  remoteUsers.push(username);
  return username;
}