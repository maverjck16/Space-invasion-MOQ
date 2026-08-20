// Gestisce la connessione al server di signaling (WebSocket) usata SOLO per la fase di
// rendez-vous WebRTC (join di stanza, scambio di offerte/risposte SDP e candidati ICE). E'
// l'equivalente, per questa sola responsabilita', di moq/connection.ts nella versione MoQ: la
// differenza fondamentale e' che qui la connessione non porta MAI lo stato di gioco, che viaggia
// invece peer-to-peer sui RTCDataChannel aperti da webrtc/peerManager.ts.
import { SIGNALING_URL, CONNECT_TIMEOUT_MS } from "../config";

export type SignalData =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type ServerMessage =
  | { type: "joined"; self: string; peers: string[] }
  | { type: "peer-joined"; username: string }
  | { type: "peer-left"; username: string }
  | { type: "signal"; from: string; data: SignalData }
  | { type: "error"; message: string };

export type SignalingHandlers = {
  onPeerJoined: (username: string) => void;
  onPeerLeft: (username: string) => void;
  onSignal: (from: string, data: SignalData) => void;
};

let socket: WebSocket | null = null;
let handlers: SignalingHandlers | null = null;
let pendingJoin: {
  resolve: (result: { self: string; peers: string[] }) => void;
  reject: (err: Error) => void;
} | null = null;

function connectWithTimeout(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeoutId = window.setTimeout(() => {
      ws.close();
      reject(
        new Error(
          `Timeout connessione al signaling (${CONNECT_TIMEOUT_MS / 1000}s) verso ${url}. ` +
            `Verifica che il server di signaling sia avviato e raggiungibile.`,
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      window.clearTimeout(timeoutId);
      resolve(ws);
    };
    ws.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error(`Errore di connessione al signaling verso ${url}.`));
    };
  });
}

function handleMessage(raw: MessageEvent<string>): void {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(raw.data) as ServerMessage;
  } catch {
    console.warn("[Signaling] Messaggio non valido ricevuto:", raw.data);
    return;
  }

  switch (msg.type) {
    case "joined":
      pendingJoin?.resolve({ self: msg.self, peers: msg.peers });
      pendingJoin = null;
      return;
    case "peer-joined":
      handlers?.onPeerJoined(msg.username);
      return;
    case "peer-left":
      handlers?.onPeerLeft(msg.username);
      return;
    case "signal":
      handlers?.onSignal(msg.from, msg.data);
      return;
    case "error":
      console.error("[Signaling] Errore dal server:", msg.message);
      pendingJoin?.reject(new Error(msg.message));
      pendingJoin = null;
      return;
  }
}

export async function connectSignaling(): Promise<WebSocket> {
  if (socket) return socket;

  socket = await connectWithTimeout(SIGNALING_URL);
  socket.onmessage = handleMessage;
  socket.onclose = () => {
    socket = null;
  };

  return socket;
}

export function getSignaling(): WebSocket {
  if (!socket) throw new Error("Connessione al signaling non inizializzata");
  return socket;
}

export function isConnected(): boolean {
  return socket !== null;
}

export function disconnectSignaling(): void {
  if (!socket) return;

  try {
    socket.close();
  } finally {
    socket = null;
    pendingJoin = null;
  }
}

export function setSignalingHandlers(h: SignalingHandlers): void {
  handlers = h;
}

// Invia il messaggio "join" e attende la risposta "joined" del server, che porta l'elenco dei
// peer gia' presenti nella room (equivalente, come contenuto informativo, di un primo
// connection.announced() nella versione MoQ).
export function joinRoom(room: string, username: string): Promise<{ self: string; peers: string[] }> {
  const ws = getSignaling();

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingJoin = null;
      reject(new Error(`Timeout in attesa di conferma join alla room "${room}".`));
    }, CONNECT_TIMEOUT_MS);

    pendingJoin = {
      resolve: (result) => {
        window.clearTimeout(timeoutId);
        resolve(result);
      },
      reject: (err) => {
        window.clearTimeout(timeoutId);
        reject(err);
      },
    };

    ws.send(JSON.stringify({ type: "join", room, username }));
  });
}

export function sendSignal(to: string, data: SignalData): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "signal", to, data }));
}
