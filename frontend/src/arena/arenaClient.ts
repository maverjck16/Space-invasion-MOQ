// Client WebSocket verso il server autoritativo dell'arena condivisa (vedi arena-server/server.js
// e arena-server/simulation.js). Modulo di solo TRASPORTO, senza alcuna logica di gioco: incapsula
// il protocollo JSON descritto in arena-server/server.js (join/state/fire in uscita,
// joined/waiting/matchStart/arena/matchEnd/peerLeft/error in entrata) dietro un'interfaccia a
// callback, cosi' che game/localGame/LocalGameEngine.ts e main.ts non debbano mai maneggiare
// direttamente un WebSocket.
//
// Questo file e' pensato per restare IDENTICO, byte per byte, sia nel progetto WebRTC che in
// quello MoQ (esattamente come src/testbed/stateHash.ts o src/testbed/scenarioPlayer.ts):
// l'arena condivisa e' un servizio di terze parti rispetto al trasporto peer-to-peer sotto
// confronto (WebRTC contro MoQ), quindi il modo in cui i due client vi si connettono deve essere
// lo stesso in entrambi i progetti, altrimenti il confronto tra le due tecnologie di trasporto ne
// risulterebbe alterato.
import { recordArenaReceived, recordArenaSent, recordServerStats } from "../metrics/metrics";

const byteCounter = new TextEncoder();

export type ArenaMatchMode = "timed" | "testbed";

export type ArenaInvaderView = {
  id: string;
  x: number;
  y: number;
};

export type ArenaAsteroidView = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  radius: number;
  health: number;
  maxHealth: number;
};

export type ArenaInvaderProjectileView = {
  id: string;
  x: number;
  y: number;
};

export type ArenaPlayerState = {
  score: number;
  lives: number;
  eliminated: boolean;
};

export type ArenaSnapshot = {
  tick: number;
  // null nel testbed (nessun timer di partita, vedi arena-server/simulation.js).
  remainingMs: number | null;
  invaders: ArenaInvaderView[];
  asteroids: ArenaAsteroidView[];
  invaderProjectiles: ArenaInvaderProjectileView[];
  players: Record<string, ArenaPlayerState>;
  // TESTBED: frame di eliminazione di ciascuna ondata scriptata gia' conclusa, nell'ordine (vedi
  // arena-server/simulation.js:knownWaveClearFrames()). Non usato per decidere nulla lato client
  // (la fine partita e' comunicata da matchEnd): solo informativo.
  wavesClearedAtFrame?: number[];
};

export type ArenaMatchOutcome = "win" | "lose" | "draw";
export type ArenaMatchEndReason = "timeUp" | "bothEliminated" | "lastWaveCleared";
export type ArenaMatchDecidedBy = "eliminationOrder" | "survival" | "score";

export type ArenaMatchResultPlayer = {
  username: string;
  outcome: ArenaMatchOutcome;
  score: number;
  eliminated: boolean;
  eliminatedAtFrame: number | null;
  finalPositionX: number;
  finalPositionY: number;
};

export type ArenaMatchResult = {
  mode: ArenaMatchMode;
  endReason: ArenaMatchEndReason;
  decidedBy: ArenaMatchDecidedBy;
  endFrame: number;
  lastWaveClearedAtFrame: number | null;
  players: ArenaMatchResultPlayer[];
};

// Stessa forma di GameDifficultyConfig (game/localGame/types.ts) / ScenarioGameConfig
// (testbed/scenario.types.ts) / DEFAULT_GAME_CONFIG (arena-server/simulation.js): non tipizzata
// nel dettaglio qui per non introdurre in un modulo di puro trasporto una dipendenza dai tipi di
// gioco (che vivono in due percorsi diversi nei due progetti) - viene solo inoltrata cosi' com'e'
// al server nel messaggio di join.
export type ArenaGameConfig = Record<string, unknown>;

export type ArenaJoinOptions = {
  matchMode?: ArenaMatchMode;
  gameConfig?: ArenaGameConfig;
  seed?: number;
};

export type ArenaClientHandlers = {
  // Notificata quando questo client e' il primo a entrare nella stanza (ancora nessun avversario).
  onWaiting?: () => void;
  // Notificata quando la stanza ha 2 giocatori: il motore di gioco locale va costruito e avviato
  // esattamente a "startAtEpochMs" (Date.now(), confrontabile tra le due macchine) - vedi main.ts.
  onMatchStart: (startAtEpochMs: number, matchMode: ArenaMatchMode) => void;
  // Un nuovo stato dell'arena condivisa, da ribroadcast a BROADCAST_HZ (vedi server.js) - non a
  // ogni frame simulato.
  onSnapshot: (snapshot: ArenaSnapshot) => void;
  // La partita e' conclusa: esito autoritativo, identico per entrambi i client per costruzione
  // (arrivano dallo stesso messaggio del server, non piu' calcolato in modo indipendente sui due
  // lati come nella vecchia architettura P2P).
  onMatchEnd: (result: ArenaMatchResult) => void;
  // L'avversario ha lasciato la stanza (disconnessione lato arena, indipendente dalla mesh P2P).
  onPeerLeft?: () => void;
  onError?: (message: string) => void;
  // La connessione si e' chiusa (volontariamente o per errore di rete).
  onClose?: () => void;
};

type ServerMessage =
  | { type: "joined"; self: string }
  | { type: "waiting" }
  | { type: "matchStart"; startAtEpochMs: number; matchMode: ArenaMatchMode }
  | ({ type: "arena" } & ArenaSnapshot)
  | { type: "matchEnd"; result: ArenaMatchResult }
  | { type: "peerLeft" }
  | { type: "error"; message: string }
  // Solo strumentazione (vedi arena-server/stats.js): finisce nel JSON delle metriche, non e' traffico di gioco.
  | { type: "serverStats"; kind: string; window?: unknown; summary?: unknown };

export type ArenaClient = {
  // Stato della propria navicella, mandato periodicamente (vedi config.NETWORK_TICK_HZ): e' il
  // solo dato che il server usa per calcolare le collisioni della propria navicella con
  // invasori/asteroidi/proiettili nemici e per puntare i nuovi asteroidi.
  sendState: (state: { x: number; y: number; width: number; height: number }) => void;
  // Un nuovo colpo sparato dalla propria navicella: il server lo simula (movimento, collisioni,
  // punteggio) per intero da qui in poi - il client continua a disegnarlo in locale in modo
  // puramente cosmetico (vedi LocalGameEngine), senza attendere conferma.
  sendFire: (shot: { id: string; x: number; y: number; vx: number; vy: number; radius: number }) => void;
  close: () => void;
};

// Apre la connessione verso il server dell'arena e fa il join alla stanza indicata. La stanza
// viene creata dal PRIMO client che arriva, con la matchMode/gameConfig/seed che porta con se'
// (vedi arena-server/server.js) - il secondo client puo' ometterli (la partita manuale non li usa)
// o ripeterli identici (il testbed li manda entrambi, dallo stesso scenario, vedi main.ts).
export function connectArena(
  url: string,
  room: string,
  username: string,
  options: ArenaJoinOptions,
  handlers: ArenaClientHandlers,
): ArenaClient {
  const socket = new WebSocket(url);

  socket.onopen = () => {
    const joinMessage = JSON.stringify({
      type: "join",
      room,
      username,
      matchMode: options.matchMode ?? "timed",
      gameConfig: options.gameConfig,
      seed: options.seed,
    });
    socket.send(joinMessage);
    recordArenaSent(byteCounter.encode(joinMessage).length);
  };

  socket.onmessage = (event) => {
    let msg: ServerMessage;
    const rawData = String(event.data);
    try {
      msg = JSON.parse(rawData) as ServerMessage;
      if (msg.type === "serverStats") {
        recordServerStats(msg);
        return;
      }
      recordArenaReceived(byteCounter.encode(rawData).length);
    } catch (err) {
      recordArenaReceived(byteCounter.encode(rawData).length);
      console.warn("[Arena] Messaggio non valido ricevuto dal server dell'arena:", err);
      return;
    }

    switch (msg.type) {
      case "joined":
        return;
      case "waiting":
        handlers.onWaiting?.();
        return;
      case "matchStart":
        handlers.onMatchStart(msg.startAtEpochMs, msg.matchMode);
        return;
      case "arena": {
        const { type: _type, ...snapshot } = msg;
        handlers.onSnapshot(snapshot);
        return;
      }
      case "matchEnd":
        handlers.onMatchEnd(msg.result);
        return;
      case "peerLeft":
        handlers.onPeerLeft?.();
        return;
      case "error":
        console.error("[Arena] Errore dal server dell'arena:", msg.message);
        handlers.onError?.(msg.message);
        return;
    }
  };

  socket.onerror = () => {
    console.warn(`[Arena] Errore di connessione verso ${url}.`);
  };

  socket.onclose = () => {
    handlers.onClose?.();
  };

  function send(payload: Record<string, unknown>): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      const data = JSON.stringify(payload);
      socket.send(data);
      recordArenaSent(byteCounter.encode(data).length);
    } catch (err) {
      console.warn("[Arena] Errore inviando un messaggio al server dell'arena:", err);
    }
  }

  return {
    sendState: (state) => send({ type: "state", ...state }),
    sendFire: (shot) => send({ type: "fire", ...shot }),
    close: () => {
      try {
        socket.close();
      } catch {
        /* connessione gia' chiusa */
      }
    },
  };
}
