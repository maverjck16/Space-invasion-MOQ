// Gestisce la mesh di RTCPeerConnection della room: una connessione (con un RTCDataChannel "game"
// bidirezionale) per ciascun peer remoto. E' l'equivalente combinato di moq/publisher.ts +
// moq/subscriber.ts nella versione MoQ: la' pubblicare (scrivere sulla propria track) e
// sottoscrivere (leggere le track altrui) erano operazioni indipendenti sopra un'unica connessione
// QUIC condivisa con il relay; qui, essendo WebRTC peer-to-peer, invio e ricezione condividono
// necessariamente lo stesso canale dati per ogni coppia di peer. Vedi README (sezione "MoQ →
// WebRTC mapping") per il dettaglio di questa differenza architetturale.
//
// Regola anti-glare: chi si unisce ad una room per ultimo e' SEMPRE l'iniziatore (crea l'offerta)
// verso ciascun peer gia' presente; chi era gia' in room non inizia mai un'offerta di propria
// iniziativa, si limita a rispondere. Questo rende impossibile una doppia offerta simultanea senza
// bisogno di logica di "rollback" della negoziazione.
import { CHANNEL_GAME, ICE_SERVERS } from "../config";
import {
  connectSignaling,
  disconnectSignaling,
  joinRoom,
  sendSignal,
  setSignalingHandlers,
  type SignalData,
} from "./connection";
import { createEmptySnapshot, type GameSnapshot } from "./snapshot";
import {
  consumePendingEcho,
  nextOutgoingSeq,
  recordPeerConnected,
  recordReceived,
  recordSent,
  type NetEnvelope,
} from "../metrics/metrics";

type PeerLink = {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  connectStartAt: number;
  connectRecorded: boolean;
  pendingCandidates: RTCIceCandidateInit[];
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const peers = new Map<string, PeerLink>();
let remoteUsers: string[] = [];

let onGameUpdateCb: (username: string, snapshot: GameSnapshot) => void = () => {};
let onPresenceUpdateCb: (users: string[]) => void = () => {};

//  Costruisce l'envelope di rete (seq/timestamp/eco per le metriche, vedi src/metrics/metrics.ts)
// attorno a un GameSnapshot e lo serializza una sola volta, cosi' i byte codificati possono essere
// riusati (senza ri-serializzare) per ogni peer connesso. Identico a buildEnvelope() nella
// versione MoQ.
function buildEnvelope(payload: GameSnapshot): { envelope: NetEnvelope; bytes: ArrayBuffer } {
  const echo = consumePendingEcho();

  const envelope: NetEnvelope = {
    v: 1,
    seq: nextOutgoingSeq(),
    tSent: performance.now(),
    echoSeq: echo?.seq,
    echoTSent: echo?.tSent,
    payload,
  };

  // RTCDataChannel.send() vuole un ArrayBuffer "puro": il buffer di un Uint8Array appena creato
  // da TextEncoder.encode() e' gia' esattamente dimensionato (byteOffset 0), quindi e' sicuro
  // riusarlo direttamente invece di ricopiare i byte.
  const bytes = textEncoder.encode(JSON.stringify(envelope)).buffer as ArrayBuffer;
  return { envelope, bytes };
}

function ensureRemoteUser(username: string): void {
  if (!remoteUsers.includes(username)) {
    remoteUsers.push(username);
    onPresenceUpdateCb([...remoteUsers]);
  }
}

function removeRemoteUser(username: string): void {
  const had = remoteUsers.includes(username);
  remoteUsers = remoteUsers.filter((u) => u !== username);
  if (had) onPresenceUpdateCb([...remoteUsers]);
}

function attachChannel(username: string, link: PeerLink, channel: RTCDataChannel): void {
  link.channel = channel;
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    if (!link.connectRecorded) {
      link.connectRecorded = true;
      recordPeerConnected(username, performance.now() - link.connectStartAt);
    }

    ensureRemoteUser(username);

    //  Primo snapshot inviato subito all'apertura del canale, cosi' il peer ha subito qualcosa da
    // renderizzare prima ancora del primo tick di rete: equivalente del primo gruppo scritto da
    // serveTrackRequests() nella versione MoQ quando arriva una nuova richiesta di sottoscrizione.
    const { envelope, bytes } = buildEnvelope(createEmptySnapshot());
    try {
      channel.send(bytes);
      recordSent(envelope.seq, bytes.byteLength);
    } catch (err) {
      console.warn(`[WebRTC] Errore invio snapshot iniziale a ${username}:`, err);
    }
  };

  channel.onclose = () => {
    removeRemoteUser(username);
  };

  channel.onerror = (event) => {
    console.warn(`[WebRTC] Errore sul canale dati con ${username}:`, event);
  };

  channel.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) return;

    let envelope: NetEnvelope;
    try {
      envelope = JSON.parse(textDecoder.decode(event.data)) as NetEnvelope;
    } catch (err) {
      console.warn(`[WebRTC] Frame non decodificabile da ${username}:`, err);
      return;
    }

    recordReceived(username, envelope, event.data.byteLength);
    ensureRemoteUser(username);
    onGameUpdateCb(username, envelope.payload);
  };
}

async function flushPendingCandidates(link: PeerLink): Promise<void> {
  const queued = link.pendingCandidates.splice(0, link.pendingCandidates.length);
  for (const candidate of queued) {
    try {
      await link.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("[WebRTC] Errore applicando un candidato ICE in coda:", err);
    }
  }
}

//  Crea (o restituisce, se gia' esistente) la RTCPeerConnection verso un peer remoto. Se
// `initiator` e' true, questo lato crea anche il DataChannel "game" e apre la negoziazione con
// un'offerta SDP - vedi nota anti-glare in cima al file.
function ensurePeerConnection(username: string, initiator: boolean): PeerLink {
  const existing = peers.get(username);
  if (existing) return existing;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const link: PeerLink = {
    pc,
    channel: null,
    connectStartAt: performance.now(),
    connectRecorded: false,
    pendingCandidates: [],
  };
  peers.set(username, link);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(username, { kind: "ice", candidate: event.candidate.toJSON() });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      if (peers.get(username) === link) {
        peers.delete(username);
        removeRemoteUser(username);
      }
    }
  };

  //  Il lato che risponde (non iniziatore) riceve il DataChannel "game" qui: solo chi crea
  // l'offerta chiama createDataChannel(), l'altro lato lo ottiene tramite questo evento.
  pc.ondatachannel = (event) => {
    attachChannel(username, link, event.channel);
  };

  if (initiator) {
    //  Canale dati "game": unordered + non affidabile (maxRetransmits: 0). E' la controparte
    // WebRTC del comportamento "prendo sempre l'ultimo gruppo, scarto i vecchi" della versione
    // MoQ (vedi readGameTrack() in moq/subscriber.ts): ogni GameSnapshot e' un'istantanea
    // completa e autosufficiente che rende obsoleto quello precedente, quindi non ha senso
    // attendere la ritrasmissione di un pacchetto perso ne' bloccare i successivi in ordine
    // (head-of-line blocking) per farlo arrivare in sequenza. Vedi README per il mapping
        // completo e la discussione della differenza (qui la perdita e' reale, in MoQ/QUIC la
    // consegna resta affidabile ma i gruppi vecchi vengono scartati a livello applicativo).
    const channel = pc.createDataChannel(CHANNEL_GAME, {
      ordered: false,
      maxRetransmits: 0,
    });
    attachChannel(username, link, channel);

    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(username, { kind: "offer", sdp: offer.sdp ?? "" });
      } catch (err) {
        console.error(`[WebRTC] Errore creazione offerta verso ${username}:`, err);
      }
    })();
  }

  return link;
}

async function handleSignal(from: string, data: SignalData): Promise<void> {
  const link = ensurePeerConnection(from, false);
  const { pc } = link;

  try {
    if (data.kind === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      await flushPendingCandidates(link);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(from, { kind: "answer", sdp: answer.sdp ?? "" });
    } else if (data.kind === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      await flushPendingCandidates(link);
    } else if (data.kind === "ice") {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      } else {
        // Puo' capitare che un candidato ICE arrivi prima della offer/answer che lo precede
        // logicamente (trickle ICE): lo mettiamo in coda e lo applichiamo non appena la
        // remote description e' impostata.
        link.pendingCandidates.push(data.candidate);
      }
    }
  } catch (err) {
    console.warn(`[WebRTC] Errore gestendo segnale "${data.kind}" da ${from}:`, err);
  }
}

function handlePeerJoined(username: string): void {
  // Un peer gia' presente non inizia mai un'offerta di propria iniziativa: si limita a creare la
  // RTCPeerConnection e attende l'offerta del nuovo arrivato (vedi nota anti-glare in cima al file).
  ensurePeerConnection(username, false);
}

function handlePeerLeft(username: string): void {
  const link = peers.get(username);
  if (link) {
    try {
      link.channel?.close();
    } catch {
      /* canale gia' chiuso */
    }
    try {
      link.pc.close();
    } catch {
      /* connessione gia' chiusa */
    }
    peers.delete(username);
  }
  removeRemoteUser(username);
}

//  Si connette al signaling, entra nella room e apre una RTCPeerConnection verso ciascun peer
// gia' presente (di cui siamo sempre iniziatori, essendo l'ultimo arrivato). Equivalente di
// startPublisher() nella versione MoQ: da qui in poi publishSnapshot() puo' effettivamente
// raggiungere dei peer.
export async function startPublisher(room: string, username: string): Promise<void> {
  await connectSignaling();
  setSignalingHandlers({
    onPeerJoined: handlePeerJoined,
    onPeerLeft: handlePeerLeft,
    onSignal: (from, data) => void handleSignal(from, data),
  });

  const { peers: existingPeers } = await joinRoom(room, username);

  for (const peerUsername of existingPeers) {
    ensurePeerConnection(peerUsername, true);
  }
}

export function stopPublisher(): void {
  for (const [, link] of peers) {
    try {
      link.channel?.close();
    } catch {
      /* canale gia' chiuso */
    }
    try {
      link.pc.close();
    } catch {
      /* connessione gia' chiusa */
    }
  }
  peers.clear();
  remoteUsers = [];
}

//  Invia un nuovo snapshot di gioco a tutti i peer con un canale dati aperto. Equivalente di
// publishSnapshot() nella versione MoQ (li' scriveva un nuovo gruppo per ogni track attiva).
export function publishSnapshot(snapshot: GameSnapshot): void {
  if (peers.size === 0) return;

  const { envelope, bytes } = buildEnvelope(snapshot);

  for (const [username, link] of peers) {
    if (!link.channel || link.channel.readyState !== "open") continue;

    try {
      link.channel.send(bytes);
      recordSent(envelope.seq, bytes.byteLength);
    } catch (err) {
      console.warn(`[WebRTC] Errore invio snapshot a ${username}:`, err);
    }
  }
}

//  Registra le callback di aggiornamento gioco/presenza. Equivalente di startSubscriber() nella
// versione MoQ: qui non deve pero' avviare da solo la scoperta dei peer (gia' gestita da
// startPublisher/handlePeerJoined), si limita a collegare le callback e a notificare subito lo
// stato di presenza corrente.
export async function startSubscriber(
  _room: string,
  _username: string,
  onGameUpdate: (remoteUsername: string, snapshot: GameSnapshot) => void,
  onPresenceUpdate?: (users: string[]) => void,
): Promise<void> {
  onGameUpdateCb = onGameUpdate;
  onPresenceUpdateCb = onPresenceUpdate ?? (() => {});
  onPresenceUpdateCb([...remoteUsers]);
}

export function stopSubscriber(): void {
  onGameUpdateCb = () => {};
  onPresenceUpdateCb = () => {};
}

export { disconnectSignaling };
