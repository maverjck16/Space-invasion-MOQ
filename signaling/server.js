// Server di signaling per Space Invasion WebRTC.
//
// Ruolo: e' l'EQUIVALENTE FUNZIONALE del moq-relay nella versione MoQ, ma solo per la parte di
// "rendez-vous" (scoperta dei peer nella room / presenza). A differenza del relay MoQ, qui NON
// transita mai lo stato di gioco (GameSnapshot): questo server smista soltanto messaggi piccoli e
// poco frequenti (join/leave, offerte/risposte SDP, candidati ICE). Il traffico di gioco vero e
// proprio viaggia peer-to-peer su RTCDataChannel una volta stabilita la connessione WebRTC - vedi
// frontend/src/webrtc/peerManager.ts.
//
// Protocollo (JSON su WebSocket):
//   client -> server:
//     { type: "join", room, username }
//     { type: "signal", to, data }              data = {kind:"offer"|"answer", sdp} | {kind:"ice", candidate}
//   server -> client:
//     { type: "joined", self, peers: string[] }  peer gia' presenti nella room al momento del join
//     { type: "peer-joined", username }
//     { type: "peer-left", username }
//     { type: "signal", from, data }
//     { type: "error", message }
//
// Regola per evitare il "glare" (doppia offerta simultanea): chi si unisce per ultimo e' sempre
// l'iniziatore della RTCPeerConnection verso ciascun peer gia' presente (vedi frontend/src/webrtc/
// peerManager.ts). Il server si limita a comunicare, al nuovo arrivato, la lista dei peer esistenti.

import { WebSocketServer } from "ws";

const PORT = Number(process.env.SIGNALING_PORT ?? 8080);

// room (string) -> Map<username, WebSocket>
const rooms = new Map();

function getRoom(room) {
  let peers = rooms.get(room);
  if (!peers) {
    peers = new Map();
    rooms.set(room, peers);
  }
  return peers;
}

function send(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

function broadcastToRoom(room, message, exceptUsername) {
  const peers = rooms.get(room);
  if (!peers) return;
  for (const [username, peerWs] of peers) {
    if (username === exceptUsername) continue;
    send(peerWs, message);
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  // Stato associato a QUESTA connessione: la room/username vengono assegnati al primo "join".
  let joinedRoom = null;
  let joinedUsername = null;

  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "JSON non valido" });
      return;
    }

    if (msg.type === "join") {
      const room = String(msg.room ?? "").trim();
      const username = String(msg.username ?? "").trim();

      if (!room || !username) {
        send(ws, { type: "error", message: "room e username sono obbligatori" });
        return;
      }

      const peers = getRoom(room);

      if (peers.has(username)) {
        send(ws, { type: "error", message: `Username "${username}" gia' in uso nella room "${room}"` });
        ws.close();
        return;
      }

      const existingPeers = [...peers.keys()];

      joinedRoom = room;
      joinedUsername = username;
      peers.set(username, ws);

      console.log(`[signaling] ${username} è entrato nella room "${room}" (peer presenti: ${existingPeers.length})`);

      send(ws, { type: "joined", self: username, peers: existingPeers });
      broadcastToRoom(room, { type: "peer-joined", username }, username);
      return;
    }

    if (msg.type === "signal") {
      if (!joinedRoom || !joinedUsername) {
        send(ws, { type: "error", message: "Devi fare join prima di segnalare" });
        return;
      }

      const peers = rooms.get(joinedRoom);
      const target = peers?.get(String(msg.to ?? ""));
      if (!target) {
        send(ws, { type: "error", message: `Peer "${msg.to}" non trovato nella room` });
        return;
      }

      send(target, { type: "signal", from: joinedUsername, data: msg.data });
      return;
    }

    send(ws, { type: "error", message: `Tipo di messaggio sconosciuto: ${msg.type}` });
  });

  ws.on("close", () => {
    if (!joinedRoom || !joinedUsername) return;

    const peers = rooms.get(joinedRoom);
    if (!peers) return;

    peers.delete(joinedUsername);
    console.log(`[signaling] ${joinedUsername} ha lasciato la room "${joinedRoom}"`);

    if (peers.size === 0) {
      rooms.delete(joinedRoom);
    } else {
      broadcastToRoom(joinedRoom, { type: "peer-left", username: joinedUsername });
    }
  });
});

// Heartbeat: chiude le connessioni WebSocket "zombie" (es. sleep del laptop, rete caduta senza un
// FIN pulito) cosi' la presenza nella room resta corretta anche in caso di disconnessioni brutali.
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

wss.on("close", () => clearInterval(heartbeatInterval));

console.log(`[signaling] server WebSocket in ascolto su ws://0.0.0.0:${PORT}`);
