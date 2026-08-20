//  Modulo dedicato alla raccolta e all'analisi delle metriche di rete/prestazioni della sessione
// multiplayer. Non tocca in alcun modo la logica di gioco (LocalGameEngine, rendering): si limita
// a osservare i messaggi che passano già da webrtc/peerManager.ts. Porting 1:1 della versione MoQ
// (moq-keycast-ts/TS/frontend/src/metrics/metrics.ts): stessa definizione di NetEnvelope, stesso
// meccanismo di echo per l'RTT, stesse formule per jitter/gap/duplicati, cosi' i numeri restano
// direttamente confrontabili tra le due implementazioni. L'unica aggiunta e' il tracking del tempo
// di connessione per-peer (recordPeerConnected), che la versione MoQ non aveva bisogno di misurare
// esplicitamente perche' non stabilisce una PeerConnection per coppia di client - vedi README.
//
//  ATTENZIONE (limite tecnico, importante): i due client (i due browser dei due giocatori) NON
// hanno orologi sincronizzati fra loro. Confrontare un timestamp preso su un client con uno preso
// sull'altro (es. "tSent" del mittente contro "now()" del destinatario) NON produce una latenza
// one-way affidabile: l'errore è pari allo sfasamento fra i due orologi, che può essere di decine
// o centinaia di millisecondi e non è quantificabile lato applicativo.
//  Per questo la latenza qui non si misura mai confrontando orologi di client diversi. Si usa
// invece un meccanismo di "echo": quando ricevo un messaggio dal peer, ne memorizzo seq+timestamp
// (preso dal MIO orologio) e lo rimando indietro nel MIO prossimo messaggio pubblicato. Quando
// il peer originale mi rimanda a sua volta l'eco, calcolo l'RTT confrontando SOLO valori presi dal
// MIO stesso orologio (nessuno sfasamento possibile). La latenza one-way viene poi stimata come
// RTT/2 (approssimazione standard, valida se il percorso di rete è ragionevolmente simmetrico).
//  Si usa performance.now() (monotono, immune a correzioni dell'orologio di sistema) e non
// Date.now(): i valori "echoTSent" hanno senso solo se re-interpretati dallo stesso client che li
// ha generati nella stessa sessione di pagina, mai confrontati fra client diversi.

import type { GameSnapshot } from "../webrtc/snapshot";
import { METRICS_LOG_INTERVAL_MS } from "../config";

//  Involucro di rete: avvolge ogni GameSnapshot con seq/timestamp/echo per instrumentation.
// GameSnapshot resta invariato: il layer di trasporto lo impacchetta/spacchetta qui, il resto
// del gioco (LocalGameEngine, game-room.ts) continua a vedere solo GameSnapshot come prima.
export type NetEnvelope = {
  v: 1;
  seq: number;
  tSent: number;
  echoSeq?: number;
  echoTSent?: number;
  payload: GameSnapshot;
};

type PerMessageRecord = {
  tRecorded: number; // performance.now() locale al momento della registrazione
  type: "send" | "recv";
  peer: string;
  seq: number;
  bytes: number;
  rttMs?: number;
  interArrivalMs?: number;
  jitterMs?: number;
  gap?: number;
  duplicateOrOutOfOrder?: boolean;
};

type PeerRecvState = {
  lastSeq: number | null;
  lastRecvAt: number | null;
  lastInterArrival: number | null;
};

const LOCAL_PEER_KEY = "__local__";

let sessionActive = false;
let sessionUsername = "";
let sessionRoom = "";
let sessionStartAt = 0;

let outgoingSeq = 0;
let pendingEcho: { seq: number; tSent: number } | undefined;

let sentCount = 0;
let bytesSent = 0;
let recvCount = 0;
let bytesReceived = 0;
let gapTotal = 0;
let duplicateOrOutOfOrderTotal = 0;

const rttSamplesMs: number[] = [];
const jitterSamplesMs: number[] = [];
const peerConnectSamplesMs: number[] = [];
const records: PerMessageRecord[] = [];
const MAX_RECORDS = 20000; // tetto di sicurezza per non far crescere la memoria all'infinito in sessioni molto lunghe

const peerState = new Map<string, PeerRecvState>();

let logIntervalId: number | null = null;
let logWindowSentStart = 0;
let logWindowSentCount = 0;
let logWindowRecvStart = 0;
let logWindowRecvCount = 0;

function pushRecord(rec: PerMessageRecord): void {
  records.push(rec);
  if (records.length > MAX_RECORDS) {
    records.splice(0, records.length - MAX_RECORDS);
  }
}

//  Avvia una nuova sessione di misurazione: resetta tutti i contatori. Va chiamata quando il
// giocatore entra effettivamente in una room (dopo connectSignaling + startPublisher).
export function startSession(username: string, room: string): void {
  sessionActive = true;
  sessionUsername = username;
  sessionRoom = room;
  sessionStartAt = performance.now();

  outgoingSeq = 0;
  pendingEcho = undefined;

  sentCount = 0;
  bytesSent = 0;
  recvCount = 0;
  bytesReceived = 0;
  gapTotal = 0;
  duplicateOrOutOfOrderTotal = 0;

  rttSamplesMs.length = 0;
  jitterSamplesMs.length = 0;
  peerConnectSamplesMs.length = 0;
  records.length = 0;
  peerState.clear();

  logWindowSentStart = sessionStartAt;
  logWindowSentCount = 0;
  logWindowRecvStart = sessionStartAt;
  logWindowRecvCount = 0;

  if (logIntervalId !== null) window.clearInterval(logIntervalId);
  logIntervalId = window.setInterval(logLiveWindow, METRICS_LOG_INTERVAL_MS);

  console.info(`[Metrics] sessione avviata: user=${username} room=${room}`);
}

//  Chiude la sessione corrente e stampa il riepilogo finale. Va chiamata quando il giocatore
// lascia la room o in caso di errore di connessione.
export function endSession(): void {
  if (!sessionActive) return;

  logSummary();

  sessionActive = false;
  if (logIntervalId !== null) {
    window.clearInterval(logIntervalId);
    logIntervalId = null;
  }
}

//  Restituisce il prossimo numero di sequenza in uscita (monotono per l'intera sessione, mai
// azzerato — a differenza del campo "tick" del gioco, che LocalGameEngine azzera periodicamente).
export function nextOutgoingSeq(): number {
  outgoingSeq += 1;
  return outgoingSeq;
}

//  Restituisce l'eco pendente (ultimo messaggio ricevuto dal peer) da allegare al prossimo
// messaggio pubblicato, per permettere al peer di calcolare il proprio RTT.
export function consumePendingEcho(): { seq: number; tSent: number } | undefined {
  return pendingEcho;
}

//  Da chiamare subito dopo aver scritto con successo un messaggio sulla rete (webrtc/peerManager.ts).
export function recordSent(seq: number, bytes: number): void {
  sentCount++;
  bytesSent += bytes;
  logWindowSentCount++;

  if (!sessionActive) return;

  pushRecord({
    tRecorded: performance.now(),
    type: "send",
    peer: LOCAL_PEER_KEY,
    seq,
    bytes,
  });
}

//  Da chiamare subito dopo aver letto con successo un messaggio dal peer remoto (webrtc/peerManager.ts).
// Calcola jitter (sempre, con il solo orologio locale) e RTT (solo se l'envelope porta un eco
// valido di qualcosa che abbiamo pubblicato noi).
export function recordReceived(peer: string, envelope: NetEnvelope, bytes: number): void {
  recvCount++;
  bytesReceived += bytes;
  logWindowRecvCount++;

  const now = performance.now();

  let state = peerState.get(peer);
  if (!state) {
    state = { lastSeq: null, lastRecvAt: null, lastInterArrival: null };
    peerState.set(peer, state);
  }

  let gap = 0;
  let duplicateOrOutOfOrder = false;
  if (state.lastSeq !== null) {
    if (envelope.seq > state.lastSeq + 1) {
      gap = envelope.seq - state.lastSeq - 1;
      gapTotal += gap;
    } else if (envelope.seq <= state.lastSeq) {
      // A differenza della versione MoQ (dove lo scarto del backlog lato subscriber rende questo
      // caso teorico), qui il DataChannel "game" e' volutamente unordered (vedi peerManager.ts):
      // arrivi fuori ordine sono un esito NORMALE e atteso, non un errore. Li contiamo comunque,
      // perche' e' esattamente uno dei numeri utili al confronto MoQ vs WebRTC.
      duplicateOrOutOfOrder = true;
      duplicateOrOutOfOrderTotal++;
    }
  }
  state.lastSeq = Math.max(state.lastSeq ?? envelope.seq, envelope.seq);

  let interArrivalMs: number | undefined;
  let jitterMs: number | undefined;
  if (state.lastRecvAt !== null) {
    interArrivalMs = now - state.lastRecvAt;
    if (state.lastInterArrival !== null) {
      jitterMs = Math.abs(interArrivalMs - state.lastInterArrival);
      jitterSamplesMs.push(jitterMs);
    }
    state.lastInterArrival = interArrivalMs;
  }
  state.lastRecvAt = now;

  let rttMs: number | undefined;
  if (envelope.echoSeq !== undefined && envelope.echoTSent !== undefined) {
    // L'eco fa riferimento solo a valori generati da NOI in questa stessa sessione di pagina:
    // il confronto è quindi valido anche se e' passato del tempo, senza alcun problema di
    // sincronizzazione fra client diversi.
    rttMs = now - envelope.echoTSent;
    if (rttMs >= 0) rttSamplesMs.push(rttMs);
  }

  // Aggiorno l'eco da allegare al prossimo invio, cosi' il peer puo' calcolare il proprio RTT.
  pendingEcho = { seq: envelope.seq, tSent: envelope.tSent };

  if (!sessionActive) return;

  pushRecord({
    tRecorded: now,
    type: "recv",
    peer,
    seq: envelope.seq,
    bytes,
    rttMs,
    interArrivalMs,
    jitterMs,
    gap: gap > 0 ? gap : undefined,
    duplicateOrOutOfOrder: duplicateOrOutOfOrder || undefined,
  });
}

//  Da chiamare quando il RTCDataChannel "game" verso un peer passa a "open": elapsedMs e' il tempo
// trascorso dall'inizio della negoziazione (creazione della RTCPeerConnection) fino all'apertura
// del canale, cioe' il "tempo di connessione" richiesto tra le metriche da poter misurare in
// futuro. Puramente additivo: non influisce sul comportamento di gioco.
export function recordPeerConnected(peer: string, elapsedMs: number): void {
  peerConnectSamplesMs.push(elapsedMs);
  console.info(`[Metrics] canale dati con ${peer} aperto in ${elapsedMs.toFixed(1)}ms`);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function stats(values: number[]): {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  count: number;
} {
  if (values.length === 0) {
    return { avg: NaN, min: NaN, max: NaN, p50: NaN, p95: NaN, p99: NaN, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    avg: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    count: sorted.length,
  };
}

export type MetricsSummary = {
  username: string;
  room: string;
  sessionDurationSec: number;
  messagesSent: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  bandwidthUpBytesPerSec: number;
  bandwidthDownBytesPerSec: number;
  updateFrequencyHz: number; // frequenza media di aggiornamenti ricevuti dal peer
  gapTotal: number; // messaggi presunti persi/superati (vedi nota limite)
  duplicateOrOutOfOrderTotal: number;
  latencyRttMs: ReturnType<typeof stats>;
  latencyOneWayEstimateMs: { avg: number; min: number; max: number; p50: number; p95: number; p99: number };
  jitterMs: { avg: number; max: number };
  peerConnectMs: ReturnType<typeof stats>;
};

export function getSummary(): MetricsSummary {
  const durationSec = Math.max(0.001, (performance.now() - sessionStartAt) / 1000);
  const rttStats = stats(rttSamplesMs);
  const jitterStats = stats(jitterSamplesMs);
  const peerConnectStats = stats(peerConnectSamplesMs);

  return {
    username: sessionUsername,
    room: sessionRoom,
    sessionDurationSec: durationSec,
    messagesSent: sentCount,
    messagesReceived: recvCount,
    bytesSent,
    bytesReceived,
    bandwidthUpBytesPerSec: bytesSent / durationSec,
    bandwidthDownBytesPerSec: bytesReceived / durationSec,
    updateFrequencyHz: recvCount / durationSec,
    gapTotal,
    duplicateOrOutOfOrderTotal,
    latencyRttMs: rttStats,
    latencyOneWayEstimateMs: {
      avg: rttStats.avg / 2,
      min: rttStats.min / 2,
      max: rttStats.max / 2,
      p50: rttStats.p50 / 2,
      p95: rttStats.p95 / 2,
      p99: rttStats.p99 / 2,
    },
    jitterMs: { avg: jitterStats.avg, max: jitterStats.max },
    peerConnectMs: peerConnectStats,
  };
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/d";
}

//  Log riassuntivo leggibile a fine sessione, con tutte le statistiche aggregate richieste.
export function logSummary(): void {
  const s = getSummary();
  console.info(
    [
      `[Metrics] === Riepilogo sessione (${s.username}@${s.room}) ===`,
      `Session duration: ${fmt(s.sessionDurationSec, 1)}s`,
      `Messages sent / received: ${s.messagesSent} / ${s.messagesReceived}`,
      `Bytes sent / received: ${s.bytesSent} / ${s.bytesReceived}`,
      `Estimated bandwidth up/down: ${fmt(s.bandwidthUpBytesPerSec / 1024, 2)} KB/s / ${fmt(s.bandwidthDownBytesPerSec / 1024, 2)} KB/s`,
      `Update frequency (recv): ${fmt(s.updateFrequencyHz, 1)} Hz`,
      `Gap totale (presunti persi/superati, vedi nota): ${s.gapTotal}`,
      `Duplicati/fuori ordine rilevati: ${s.duplicateOrOutOfOrderTotal}`,
      `Latency RTT avg/min/max/p50/p95/p99 (ms): ${fmt(s.latencyRttMs.avg)} / ${fmt(s.latencyRttMs.min)} / ${fmt(s.latencyRttMs.max)} / ${fmt(s.latencyRttMs.p50)} / ${fmt(s.latencyRttMs.p95)} / ${fmt(s.latencyRttMs.p99)}`,
      `Latency one-way stimata (RTT/2) avg/p95 (ms): ${fmt(s.latencyOneWayEstimateMs.avg)} / ${fmt(s.latencyOneWayEstimateMs.p95)}`,
      `Jitter avg/max (ms): ${fmt(s.jitterMs.avg)} / ${fmt(s.jitterMs.max)}`,
      `Tempo di connessione DataChannel avg/min/max (ms): ${fmt(s.peerConnectMs.avg)} / ${fmt(s.peerConnectMs.min)} / ${fmt(s.peerConnectMs.max)}`,
    ].join("\n"),
  );
}

function logLiveWindow(): void {
  const now = performance.now();
  const sentElapsed = (now - logWindowSentStart) / 1000;
  const recvElapsed = (now - logWindowRecvStart) / 1000;

  console.debug(
    `[Metrics live] send=${(logWindowSentCount / Math.max(sentElapsed, 0.001)).toFixed(1)}/s ` +
      `recv=${(logWindowRecvCount / Math.max(recvElapsed, 0.001)).toFixed(1)}/s ` +
      `rtt(ultimi)=${rttSamplesMs.length ? rttSamplesMs[rttSamplesMs.length - 1].toFixed(1) : "n/d"}ms`,
  );

  logWindowSentStart = now;
  logWindowSentCount = 0;
  logWindowRecvStart = now;
  logWindowRecvCount = 0;
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

//  Esporta il riepilogo + il log completo dei singoli messaggi in un file JSON scaricabile.
export function exportJSON(): void {
  const data = {
    summary: getSummary(),
    records: records.map((r) => ({
      tRecordedMs: r.tRecorded,
      type: r.type,
      peer: r.peer,
      seq: r.seq,
      bytes: r.bytes,
      rttMs: r.rttMs ?? null,
      interArrivalMs: r.interArrivalMs ?? null,
      jitterMs: r.jitterMs ?? null,
      gap: r.gap ?? null,
      duplicateOrOutOfOrder: r.duplicateOrOutOfOrder ?? null,
    })),
  };
  downloadFile(
    `webrtc-metrics-${sessionUsername}-${sessionRoom}-${timestampForFilename()}.json`,
    JSON.stringify(data, null, 2),
    "application/json",
  );
}

//  Esporta il log dei singoli messaggi in CSV (punto e virgola come separatore: e' il default
// atteso da Excel in locale italiano, dove la virgola è il separatore decimale).
export function exportCSV(): void {
  const header = [
    "timestamp_ms",
    "type",
    "peer",
    "seq",
    "latency_rtt_ms",
    "jitter_ms",
    "inter_arrival_ms",
    "bytes",
    "gap",
    "duplicate_or_out_of_order",
  ].join(";");

  const rows = records.map((r) =>
    [
      r.tRecorded.toFixed(3),
      r.type,
      r.peer,
      r.seq,
      r.rttMs !== undefined ? r.rttMs.toFixed(3) : "",
      r.jitterMs !== undefined ? r.jitterMs.toFixed(3) : "",
      r.interArrivalMs !== undefined ? r.interArrivalMs.toFixed(3) : "",
      r.bytes,
      r.gap ?? "",
      r.duplicateOrOutOfOrder ? "1" : "",
    ].join(";"),
  );

  downloadFile(
    `webrtc-metrics-${sessionUsername}-${sessionRoom}-${timestampForFilename()}.csv`,
    [header, ...rows].join("\n"),
    "text/csv",
  );
}
