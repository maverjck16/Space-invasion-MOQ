// Server autoritativo dell'arena condivisa per Space Invasion WebRTC.
//
// Ruolo: prima di questa modifica, invasori/asteroidi/proiettili nemici venivano simulati in modo
// identico su ENTRAMBI i client grazie a un generatore pseudo-casuale seedato (vedi
// frontend/src/testbed/rng.ts) installato allo stesso momento su entrambi. Il tutor ha fatto
// notare che questa non e' un'architettura multiplayer valida: un vero gioco in tempo reale (l'
// esempio fatto e' stato agar.io) genera i nemici sul server, i client si limitano a
// sottoscriversi e disegnarli. Questo processo e' quel server: l'unica copia esistente dello
// stato dell'arena condivisa vive qui (vedi arena-server/simulation.js per la logica vera e
// propria, tenuta separata da questo file perche' non ha alcuna dipendenza da WebSocket/rete e
// puo' quindi essere riusata identica dagli script offline di verifica del testbed).
//
// I client continuano a scambiarsi PEER-TO-PEER (via WebRTC DataChannel, vedi
// frontend/src/webrtc/peerManager.ts, invariato in questa parte) solo la posizione della propria
// navicella e i propri proiettili (per un rendering fluido e a bassa latenza dell'avversario) - un
// dato puramente cosmetico che non decide mai punteggio o collisioni. Tutto cio' che e'
// realmente condiviso (dove sono gli invasori/asteroidi, chi ha vinto un colpo, quanti punti/vite
// ha ciascuno) passa da qui, su una connessione WebSocket separata, aperta da entrambi i client
// verso questo processo.
//
// Protocollo (JSON su WebSocket):
//   client -> server:
//     { type: "join", room, username, matchMode: "timed"|"testbed", gameConfig?, seed? }
//     { type: "state", x, y, vx, vy, rotation, opacity, width, height }
//     { type: "fire", id, x, y, vx, vy, radius }
//   server -> client:
//     { type: "joined", self }
//     { type: "waiting" }
//     { type: "matchStart", startAtEpochMs, matchMode }
//     { type: "arena", ...vedi simulation.js:getSnapshot() }
//     { type: "matchEnd", result }
//     { type: "peerLeft" }
//     { type: "error", message }

const { WebSocketServer } = require("ws");
const { createRoom, FRAME_MS } = require("./simulation");
const { createRoomStats } = require("./stats");

const PORT = Number(process.env.ARENA_PORT ?? 8081);
// Frequenza di invio degli snapshot dell'arena ai client - stessa di NETWORK_TICK_HZ in config.ts,
// cosi' il carico di rete introdotto da questo nuovo canale resta comparabile (in ordine di
// grandezza) con quello gia' misurato per il canale P2P giocatore-giocatore.
const BROADCAST_HZ = 25;

// room (string) -> RoomEntry
const rooms = new Map();

// countStats=false per i messaggi "serverStats": sono strumentazione, non traffico di gioco, e non
// devono comparire ne' nei byte contati dal server ne' in quelli contati dal client.
function send(ws, message, countStats = true) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    const data = JSON.stringify(message);
    ws.send(data);
    if (countStats) ws.roomStats?.onSent(Buffer.byteLength(data));
  } catch {
    /* connessione gia' in chiusura */
  }
}

function createRoomEntry(name) {
  return {
    name,
    room: null, // creata al primo "join" con matchMode/gameConfig/seed di quel client
    sockets: new Map(), // username -> ws
    simTimer: null,
    broadcastTimer: null,
    matchEndSent: false,
    stats: createRoomStats(name),
  };
}

function attachStatsForwarding(entry) {
  entry.stats.setListener((payload) => {
    for (const ws of entry.sockets.values()) send(ws, { type: "serverStats", ...payload }, false);
  });
}

function getOrCreateRoomEntry(name) {
  let entry = rooms.get(name);
  if (!entry) {
    entry = createRoomEntry(name);
    attachStatsForwarding(entry);
    rooms.set(name, entry);
  }
  return entry;
}

function startLoops(entry) {
  entry.stats.start();
  entry.simTimer = setInterval(() => {
    entry.stats.timeTick(() => entry.room.tickOnce());
    if (!entry.matchEndSent && entry.room.isEnded()) {
      entry.matchEndSent = true;
      const result = entry.room.getResult();
      for (const ws of entry.sockets.values()) send(ws, { type: "matchEnd", result });
      stopLoops(entry);
    }
  }, FRAME_MS);

  entry.broadcastTimer = setInterval(() => {
    if (!entry.room || !entry.room.hasStarted()) return;
    const snapshot = entry.room.getSnapshot();
    entry.stats.sampleEntities(
      (snapshot.invaders?.length ?? 0) + (snapshot.asteroids?.length ?? 0) + (snapshot.invaderProjectiles?.length ?? 0),
    );
    for (const ws of entry.sockets.values()) send(ws, { type: "arena", ...snapshot });
  }, 1000 / BROADCAST_HZ);
}

function stopLoops(entry) {
  entry.stats.finish();
  if (entry.simTimer) clearInterval(entry.simTimer);
  if (entry.broadcastTimer) clearInterval(entry.broadcastTimer);
  entry.simTimer = null;
  entry.broadcastTimer = null;
}

function destroyRoomEntry(name) {
  const entry = rooms.get(name);
  if (!entry) return;
  stopLoops(entry);
  entry.room?.destroy();
  rooms.delete(name);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  let joinedRoomName = null;
  let joinedUsername = null;

  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    ws.roomStats?.onReceived(raw.length);
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "JSON non valido" });
      return;
    }

    if (msg.type === "join") {
      const roomName = String(msg.room ?? "").trim();
      const username = String(msg.username ?? "").trim();
      if (!roomName || !username) {
        send(ws, { type: "error", message: "room e username sono obbligatori" });
        return;
      }

      const entry = getOrCreateRoomEntry(roomName);
      if (entry.sockets.has(username)) {
        send(ws, { type: "error", message: `Username "${username}" gia' presente nella stanza "${roomName}"` });
        ws.close();
        return;
      }

      // La stanza viene creata dal PRIMO client che entra, con la modalita'/configurazione che
      // porta con se' (rilevante solo per il testbed: la partita manuale non manda ne'
      // gameConfig ne' seed, la stanza usa i valori di default - vedi simulation.js). Se un
      // secondo join arrivasse con parametri diversi (non dovrebbe succedere: i due client di una
      // stessa room vengono avviati con lo stesso scenario) vengono ignorati: la stanza resta
      // quella decisa dal primo arrivato.
      if (!entry.room) {
        entry.room = createRoom({
          matchMode: msg.matchMode === "testbed" ? "testbed" : "timed",
          gameConfig: msg.gameConfig ?? null,
          seed: typeof msg.seed === "number" ? msg.seed : null,
        });
      }

      joinedRoomName = roomName;
      joinedUsername = username;
      entry.sockets.set(username, ws);
      ws.roomStats = entry.stats;
      entry.room.addPlayer(username);

      console.log(`[arena] ${username} è entrato nella stanza "${roomName}" (giocatori: ${entry.sockets.size})`);
      send(ws, { type: "joined", self: username });

      if (entry.sockets.size < 2) {
        send(ws, { type: "waiting" });
      } else {
        const startAtEpochMs = entry.room.startAtEpochMs();
        for (const peerWs of entry.sockets.values()) {
          send(peerWs, { type: "matchStart", startAtEpochMs, matchMode: entry.room.matchMode });
        }
        startLoops(entry);
      }
      return;
    }

    if (!joinedRoomName || !joinedUsername) {
      send(ws, { type: "error", message: "Devi fare join prima di inviare stato di gioco" });
      return;
    }

    const entry = rooms.get(joinedRoomName);
    if (!entry || !entry.room) return;

    if (msg.type === "state") {
      entry.room.setPlayerState(joinedUsername, msg);
      return;
    }

    if (msg.type === "fire") {
      entry.room.fire(joinedUsername, msg);
      return;
    }

    send(ws, { type: "error", message: `Tipo di messaggio sconosciuto: ${msg.type}` });
  });

  ws.on("close", () => {
    if (!joinedRoomName || !joinedUsername) return;
    const entry = rooms.get(joinedRoomName);
    if (!entry) return;

    entry.sockets.delete(joinedUsername);
    entry.room?.removePlayer(joinedUsername);
    console.log(`[arena] ${joinedUsername} ha lasciato la stanza "${joinedRoomName}"`);

    if (entry.sockets.size === 0) {
      destroyRoomEntry(joinedRoomName);
    } else {
      for (const peerWs of entry.sockets.values()) send(peerWs, { type: "peerLeft" });
      // Partita rimasta con un solo giocatore: si ferma qui (niente avversario da servire). Una
      // nuova partita in questa stanza richiederebbe un nuovo secondo giocatore, che ricreerebbe
      // la stanza da capo tramite un nuovo "join" (vedi sopra) una volta che anche il primo si sia
      // disconnesso e riconnesso.
      stopLoops(entry);
    }
  });
});

// Stesso meccanismo di heartbeat gia' usato dal signaling server (vedi signaling/server.js): chiude
// le connessioni "zombie" (sleep del laptop, rete caduta senza FIN pulito).
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

console.log(`[arena] server autoritativo in ascolto su ws://0.0.0.0:${PORT}`);
