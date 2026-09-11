//  Questo file contiene la logica del publisher, che si occupa di pubblicare lo stato di gioco del giocatore locale ai subscriber
//  connessi alla stessa room.
import * as Moq from "@moq/lite";
import {
  APP_PREFIX,
  TRACK_GAME,
  MATCH_INIT_LEAD_MS,
  MATCH_INIT_RESEND_WINDOW_MS,
} from "../config";
import { connectToRelay } from "./connection";
import {
  nextOutgoingSeq,
  consumePendingEcho,
  recordSent,
  type NetEnvelope,
} from "../metrics/metrics";

//esporta tutti i tipi di snapshot del gioco, che vengono usati sia dal publisher che dal subscriber.
//
// 1v1: rispetto alla versione "a specchio" precedente, il campo di gioco (griglie di invasori,
// asteroidi, proiettili nemici) NON viaggia piu' in rete. I due client lo simulano in locale in modo
// IDENTICO (stesso seed deterministico, stesso numero di frame dallo stesso istante di partenza
// condiviso - vedi testbed/rng.ts e l'handshake in questo file/subscriber.ts/main.ts), quindi
// trasmetterlo sarebbe ridondante. Resta in rete solo cio' che e' realmente diverso da client a
// client: la propria navicella, i propri proiettili, punteggio/vite, e un piccolo elenco di id di
// entita' del campo condiviso eliminate dai propri colpi (killedIds), cosi' l'altro client puo'
// rimuoverle dalla propria copia locale del campo e non doppio-contarle. Vedi LocalGameEngine.ts
// per come viene usato tutto questo. Struttura identica 1:1 alla versione WebRTC (webrtc/snapshot.ts).
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

// 1v1: mandato dal lato che genera l'handshake (vedi ensureLocalMatchInit()/claimMatchInitiator()
// sotto e subscriber.ts per chi decide di generarlo) - installa lo stesso seed deterministico e lo
// stesso istante di partenza su entrambi i client, cosi' le due simulazioni locali del campo
// condiviso restano identiche. Riallegato per una breve finestra dopo la generazione (vedi
// outgoingMatchInit() sotto) invece che una volta sola, perche' i gruppi vecchi di una track MoQ
// vengono scartati a favore dei piu' recenti (vedi subscriber.ts, readGameTrack): un singolo invio
// potrebbe non essere mai letto se sovrascritto da un gruppo successivo prima che il subscriber lo
// consumi. Assente/undefined fuori da questa finestra.
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
  // 1v1: presente solo durante la finestra di handshake iniziale, vedi MatchInit sopra.
  matchInit?: MatchInit;
};

let broadcast: Moq.Broadcast | null = null;
const activeGameTracks = new Set<Moq.Track>();

const textEncoder = new TextEncoder();

// 1v1: seed + istante di partenza condiviso per la partita, generato UNA SOLA VOLTA da questo
// client quando si scopre iniziatore verso l'avversario - vedi claimMatchInitiator() sotto e
// subscriber.ts per la regola con cui si decide chi lo e' (a differenza della versione WebRTC, qui
// non esiste un ordine di arrivo esplicito fornito dal "server" di presenza - vedi commento in
// subscriber.ts per il perche' e per la regola usata al suo posto).
let localMatchInit: MatchInit | null = null;
// Istante (Date.now()) in cui localMatchInit e' stato generato - usato solo per sapere per quanto
// ancora riallegarlo agli snapshot/gruppi in uscita, vedi outgoingMatchInit() sotto.
let localMatchInitAtMs = 0;

//  1v1: notificata SOLO la prima volta che questo client genera il proprio matchInit (diventando
// iniziatore). E' cosi' che main.ts scopre di dover avviare anche il proprio motore locale con lo
// stesso seed/istante appena inviato all'avversario: non possiamo far leggere a main.ts il valore
// restituito dalla callback onGameUpdate di startSubscriber, perche' quella riceve solo i messaggi
// ricevuti DAGLI ALTRI, mai i propri. Nessun nuovo canale di rete: e' un evento puramente locale.
let onLocalMatchInitCb: (init: MatchInit) => void = () => {};

export function setLocalMatchInitHandler(cb: (init: MatchInit) => void): void {
  onLocalMatchInitCb = cb;
}

function ensureLocalMatchInit(): MatchInit {
  if (!localMatchInit) {
    localMatchInit = {
      seed: Math.floor(Math.random() * 0xffffffff),
      startAtEpochMs: Date.now() + MATCH_INIT_LEAD_MS,
    };
    localMatchInitAtMs = Date.now();
    onLocalMatchInitCb(localMatchInit);
  }
  return localMatchInit;
}

//  1v1: chiamata da subscriber.ts quando si accorge (confrontando il proprio username con quello
// dell'avversario appena scoperto, vedi li' per i dettagli) di essere l'iniziatore dell'handshake
// per questa partita. Idempotente: se il matchInit locale esiste gia', non fa nulla.
export function claimMatchInitiator(): void {
  ensureLocalMatchInit();
}

//  1v1: espone il matchInit generato da QUESTO client (se e quando lo diventa) - usato solo come
// lettura difensiva; il meccanismo principale per reagirvi e' setLocalMatchInitHandler() sopra.
export function getLocalMatchInit(): MatchInit | null {
  return localMatchInit;
}

//  1v1: il matchInit da allegare al PROSSIMO snapshot/gruppo in uscita, se presente e ancora dentro
// la finestra di ri-trasmissione (vedi MATCH_INIT_RESEND_WINDOW_MS in config.ts) - vedi il commento
// su MatchInit sopra per il motivo (i gruppi vecchi di una track vengono scartati a favore dei piu'
// recenti, quindi allegarlo una volta sola rischierebbe di perderlo). Riallegarlo e' innocuo lato
// ricevente (main.ts applica il primo che riceve e ignora i successivi), e dopo la finestra il
// traffico torna simmetrico tra i due lati per il resto della partita.
function outgoingMatchInit(): MatchInit | undefined {
  if (!localMatchInit) return undefined;
  if (Date.now() - localMatchInitAtMs > MATCH_INIT_RESEND_WINDOW_MS) return undefined;
  return localMatchInit;
}

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
  // 1v1: una nuova room/partita deve generare un nuovo seed condiviso, non riusare quello (ormai
  // scaduto) della partita precedente.
  localMatchInit = null;
  localMatchInitAtMs = 0;
  onLocalMatchInitCb = () => {};
}

//  Questa funzione si occupa di pubblicare un nuovo snapshot di gioco sui track di gioco attivi, scrivendo il suo contenuto
// come JSON (avvolto in un envelope con seq/timestamp per le metriche) in un nuovo gruppo di ogni track.
export function publishSnapshot(snapshot: GameSnapshot): void {
  if (activeGameTracks.size === 0) return;

  // 1v1: finche' siamo dentro la finestra di ri-trasmissione (vedi outgoingMatchInit() sopra),
  // riallega il matchInit anche ai normali snapshot periodici del motore locale - copre il caso in
  // cui il primo gruppo scritto in serveTrackRequests() sia stato scartato (vedi nota su MatchInit).
  const matchInit = outgoingMatchInit();
  if (matchInit) snapshot.matchInit = matchInit;

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

    //  1v1: se a questo momento risultiamo gia' iniziatori (vedi claimMatchInitiator()), il primo
    // gruppo scritto per questo nuovo subscriber porta gia' il matchInit - se non lo siamo ancora
    // (la determinazione in subscriber.ts non e' ancora avvenuta), publishSnapshot() lo riallega
    // comunque ai prossimi tick regolari appena disponibile, vedi outgoingMatchInit() sopra.
    const emptySnapshot = createEmptySnapshot();
    emptySnapshot.matchInit = outgoingMatchInit();
    const { envelope, bytes } = buildEnvelope(emptySnapshot);
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
    score: 0,
    lives: 0,
    gameOver: false,
    gameActive: true,
  };
}
