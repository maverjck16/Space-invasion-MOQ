// Costanti globali. Struttura speculare a moq-keycast-ts/TS/frontend/src/config.ts, cosi' il
// confronto tra le due implementazioni resta diretto voce per voce.

// URL del server di signaling WebSocket (equivalente, per la sola fase di rendez-vous, del
// RELAY_URL della versione MoQ). Il traffico di gioco NON passa da qui: vedi src/webrtc/peerManager.ts.
<<<<<<< HEAD
export const SIGNALING_URL = "ws://20.19.48.192/ws";
=======
export const SIGNALING_URL = "ws://34.154.34.239:8080";
>>>>>>> 41ebc3a (forzo turn)
// export const SIGNALING_URL = "wss://space-invasion-signaling-fb.loca.lt"; // tunnel pubblico (loca.lt, instabile) per accesso esterno
// export const SIGNALING_URL = "wss://spaceinvasion.ddns.net:8080"; // esempio per deployment remoto

// Nome del DataChannel usato per lo stato di gioco, equivalente della TRACK_GAME MoQ.
export const CHANNEL_GAME = "game";

// Server TURN opzionale (es. coturn, vedi cartella turn/ nella root del progetto e turn/README.md).
//
// Perche' serve: il relay MoQ instrada SEMPRE il traffico su una macchina remota (client -> relay
// -> client, due hop di rete). WebRTC invece, quando i due client sono sulla stessa rete/macchina
// (come nell'uso tipico del Testbed in locale), sceglie quasi certamente un candidato ICE diretto
// (host o server-reflexive via STUN, un solo hop): il confronto tra le due tecnologie risulta cosi'
// sbilanciato a favore di WebRTC non per il trasporto in se', ma perche' sta percorrendo una strada
// piu' corta (vedi relazione, capitolo "Un punto aperto: rete locale e rete reale per WebRTC").
//
// Configurando qui l'URL/le credenziali di un server TURN e lasciando FORCE_TURN_RELAY = true (di
// default sotto), ENTRAMBI i client WebRTC sono costretti a scambiarsi i dati passando dal relay
// TURN, replicando la stessa topologia a due hop del relay MoQ: un confronto molto piu' equo dal
// punto di vista della rete effettivamente attraversata.
//
// Lasciare TURN_URL vuoto per tornare al comportamento originale (solo STUN pubblico, nessun TURN).
<<<<<<< HEAD
const TURN_URL = "turn:20.19.48.192:443";
const TURN_USERNAME = "spaceinvasion";
const TURN_CREDENTIAL = "SaraeFranci1816";
=======
const TURN_URL = "turn:34.154.34.239:3478?transport=udp"; // es. "turn:IP_O_DOMINIO_DEL_TUO_SERVER:3478" oppure "turns:dominio:5349" (TLS)
const TURN_USERNAME = "spaceinvasion"; // deve combaciare con "user=" in turn/turnserver.conf
const TURN_CREDENTIAL = "SaraFranci1816"; // deve combaciare con la password dopo i due punti in "user=...:PASSWORD"
>>>>>>> 41ebc3a (forzo turn)

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(TURN_URL
    ? [
        {
          urls: TURN_URL,
          username: TURN_USERNAME,
          credential: TURN_CREDENTIAL,
        },
      ]
    : []),
];

// Se true (e TURN_URL e' configurato), forza TUTTO il traffico ICE a passare dal server TURN
// sopra: vengono usati solo candidati di tipo "relay", niente host/server-reflexive diretti. E'
// l'impostazione da usare per gli esperimenti di confronto con MoQ descritti sopra.
//
// Se TURN_URL e' vuoto questo flag non ha effetto (nessun candidato relay disponibile: forzare
// "relay" senza un TURN configurato farebbe fallire ogni connessione), quindi va attivato solo
// insieme a un TURN_URL valido.
export const FORCE_TURN_RELAY = true;

export const ICE_TRANSPORT_POLICY: RTCIceTransportPolicy =
  TURN_URL && FORCE_TURN_RELAY ? "relay" : "all";

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
