// Costanti globali. Struttura speculare a moq-keycast-ts/TS/frontend/src/config.ts, cosi' il
// confronto tra le due implementazioni resta diretto voce per voce.

// URL del server di signaling WebSocket (equivalente, per la sola fase di rendez-vous, del
// RELAY_URL della versione MoQ). Il traffico di gioco NON passa da qui: vedi src/webrtc/peerManager.ts.
export const SIGNALING_URL = "ws://localhost:8080";
// export const SIGNALING_URL = "wss://space-invasion-signaling-fb.loca.lt"; // tunnel pubblico (loca.lt, instabile) per accesso esterno
// export const SIGNALING_URL = "wss://spaceinvasion.ddns.net:8080"; // esempio per deployment remoto

// Nome del DataChannel usato per lo stato di gioco, equivalente della TRACK_GAME MoQ.
export const CHANNEL_GAME = "game";

// Server ICE per la negoziazione WebRTC. Uno STUN pubblico basta per NAT traversal in rete
// locale/la maggior parte delle reti domestiche (che e' il contesto di questo esperimento, analogo
// a quello della versione MoQ con relay unico). Per reti con NAT simmetrico/restrittivo servirebbe
// anche un server TURN, non incluso qui per restare aderenti al principio "nessuna dipendenza non
// necessaria" (vedi README, sezione differenze inevitabili).
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

// Timeout massimo per la connessione al server di signaling: se scade, l'errore viene mostrato
// subito invece di aspettare il timeout, molto più lungo, del browser.
export const CONNECT_TIMEOUT_MS = 8000;

// Timeout massimo per l'apertura del RTCDataChannel con un peer (negoziazione ICE + DTLS inclusa).
export const PEER_CONNECT_TIMEOUT_MS = 15000;

// Frequenza di invio degli snapshot di gioco sulla rete, disaccoppiata dal frame rate di
// rendering (60fps): identica alla versione MoQ per rendere il confronto equo (stesso workload).
export const NETWORK_TICK_HZ = 25;

// Ogni quanto stampare in console le metriche di rete "live" (send/sec, recv/sec, ultimo RTT).
// Il riepilogo completo (avg/min/max/p50/p95/p99 ecc.) viene comunque stampato sempre a fine
// sessione, indipendentemente da questo intervallo - vedi src/metrics/metrics.ts
export const METRICS_LOG_INTERVAL_MS = 5000;
