//Il publisher invia gli snapshot del gioco e il subscriber gli riceve così da poter aggiornare lo stato del gioco dei giocatori remoti. 
// Il subscriber si occupa anche di tenere traccia degli utenti presenti nella room, così da poter mostrare una lista dei giocatori 
// connessi, o gestire una lobby di attesa prima dell'inizio del gioco.
//Quando arriva un aggiornamento chiama onGameUpdate, che aggiorna lo stato del gioco del giocatore remoto.
//  Quando un utente si connette o disconnette, chiama onPresenceUpdate,

import * as Moq from "@moq/lite";
import { APP_PREFIX, TRACK_GAME, TRACK_PRIORITY } from "../config";
import { connectToRelay, type MoqConnection } from "./connection";
import type { GameSnapshot } from "./publisher";
import { recordReceived, type NetEnvelope } from "../metrics/metrics";

const textDecoder = new TextDecoder();

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
//
//  IMPORTANTE: track.nextGroup() di @moq/lite è una coda FIFO stretta (state.groups.shift()) e non
// scarta mai i gruppi vecchi. Se il publisher produce snapshot più veloce di quanto riusciamo a
// consumarli (es. per un attimo di jitter di rete), i gruppi si accumulano in un backlog e questo
// loop finirebbe per mostrare per secondi stati di gioco ormai superati, uno via l'altro, prima di
// raggiungere quello attuale: è la causa del "ritardo/freeze" del giocatore remoto.
//  Qui invece leggiamo direttamente track.state.groups (esposto pubblicamente da @moq/lite): ad
// ogni giro prendiamo sempre l'ULTIMO gruppo del buffer - i gruppi sono mantenuti ordinati per
// "sequence" da appendGroup()/writeGroup(), quindi l'ultimo è sempre il più recente arrivato,
// indipendentemente dall'ordine di arrivo dei singoli pacchetti QUIC - e chiudiamo tutti quelli
// più vecchi, così non si accumula mai backlog né memoria e mostriamo sempre lo stato più fresco.
//  Nota sul campo "tick": non lo usiamo per scartare gli snapshot vecchi perché non è monotono a
// livello applicativo (LocalGameEngine lo azzera sia al restart sia periodicamente quando spawna
// una nuova griglia di invasori, vedi animate()); il "sequence" del gruppo MoQ, che non si azzera
// mai, è il meccanismo equivalente più robusto richiesto. Lo usiamo comunque per il log diagnostico.
async function readGameTrack(
  track: Moq.Track,
  username: string,
  signal: AbortSignal,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  for (;;) {
    if (signal.aborted) break;

    const groups = track.state.groups.peek();

    if (groups.length === 0) {
      const closed = track.state.closed.peek();
      //  Un errore qui (es. WebTransportError: Received RESET_STREAM) NON deve far morire il loop:
      // prima capitava che questa funzione venisse invocata con "void readGameTrack(...)" senza
      // .catch(), quindi un throw qui usciva come unhandled rejection e il loop si fermava per
      // sempre, congelando lo schermo del remoto sull'ultimo frame ricevuto senza alcun segnale.
      // Trattiamo quindi un errore sulla track come una disconnessione pulita del remoto.
      if (closed instanceof Error || closed) {
        if (closed instanceof Error) {
          console.warn(`[Subscriber] Track di gioco di ${username} chiusa con errore:`, closed);
        }
        remoteUsers = remoteUsers.filter((u) => u !== username);
        onPresenceUpdate?.([...remoteUsers]);
        break;
      }
      await Moq.Signals.Signal.race(track.state.groups, track.state.closed);
      continue;
    }

    // I gruppi in coda sono ordinati per sequence crescente: l'ultimo è sempre il più recente.
    const latest = groups[groups.length - 1];
    const stale = groups.slice(0, -1);
    track.state.groups.mutate((gs) => {
      gs.length = 0;
    });
    for (const staleGroup of stale) {
      staleGroup.close();
    }

    //  La lettura di un singolo gruppo può fallire (es. RESET_STREAM su quel gruppo specifico)
    // senza che la track nel suo complesso sia compromessa: logghiamo e riproviamo al giro
    // successivo invece di lasciar risalire l'eccezione e uccidere il loop (vedi commento sopra).
    let frame: Awaited<ReturnType<typeof latest.readFrame>>;
    try {
      frame = await latest.readFrame();
    } catch (err) {
      console.warn(`[Subscriber] Errore lettura frame da ${username}, riprovo:`, err);
      continue;
    }
    if (!frame) continue;

    const envelope = JSON.parse(textDecoder.decode(frame)) as NetEnvelope;
    recordReceived(username, envelope, frame.byteLength);

    ensureRemoteUser(username);
    onGameUpdate(username, envelope.payload);
  }
}

function ensureRemoteUser(username: string): string {
  const existing = remoteUsers.find((u) => u === username);

  if (existing) return existing;

  remoteUsers.push(username);
  return username;
}