// Costanti globali. Struttura speculare a moq-keycast-ts/TS/frontend/src/config.ts, cosi' il
// confronto tra le due implementazioni resta diretto voce per voce.

// URL del server di signaling WebSocket (equivalente, per la sola fase di rendez-vous, del
// RELAY_URL della versione MoQ). Il traffico di gioco NON passa da qui: vedi src/webrtc/peerManager.ts.
export const SIGNALING_URL = "ws://34.154.34.239:443"; // stesso schema a singola porta gia' usato sulla VM Politecnico/OpenStack (funzionante): 80 frontend, 443 signaling (TCP) + TURN (UDP, vedi sotto). Su questa VM GCP le porte 443/4443 sono normalmente occupate dal relay MoQ (vedi deploy/DEPLOY.md), ma i due stack (MoQ e WebRTC) vengono avviati/fermati uno alla volta, mai insieme, quindi non c'e' conflitto in pratica
// export const SIGNALING_URL = "ws://localhost:8080"; // sviluppo locale
// export const SIGNALING_URL = "wss://space-invasion-signaling-fb.loca.lt"; // tunnel pubblico (loca.lt, instabile) per accesso esterno
// export const SIGNALING_URL = "wss://spaceinvasion.ddns.net:8080"; // esempio per deployment remoto

// 1v1: URL del server autoritativo dell'arena condivisa (vedi arena-server/server.js). Sostituisce
// la simulazione locale identica sui due client (stesso seed pseudo-casuale installato su
// entrambi, vedi la versione precedente di questo file): invasori/asteroidi/proiettili nemici,
// punteggio, vite e la fine partita sono decisi UNA SOLA VOLTA li', su questa connessione
// WebSocket separata dal signaling - i due client si limitano a mandare la posizione della propria
// navicella/i propri colpi e a renderizzare cio' che arriva da qui. Stesso host del signaling,
// porta dedicata (vedi deploy/.env.example, ARENA_PORT).
export const ARENA_URL = "ws://34.154.34.239:8081";
// export const ARENA_URL = "ws://localhost:8081"; // sviluppo locale

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
// TURN attivo: coturn (vedi turn/turnserver.conf) gira sulla stessa VM del signaling e ascolta in
// UDP sulla porta 443 (listening-port=443 + no-tcp: la TCP 443 resta libera per il signaling
// WebSocket, protocolli diversi sulla stessa porta non confliggono). Stesso schema gia' usato e
// verificato funzionante sulla VM Politecnico/OpenStack. Il range 49152-49452 UDP (vedi
// turnserver.conf) resta comunque necessario per il traffico relayato vero e proprio e va aperto
// separatamente sul firewall/VPC della VM (vedi deploy/DEPLOY.md punto 3).
const TURN_URL = "turn:34.154.34.239:443?transport=udp"; // es. "turns:dominio:5349" per TLS
const TURN_USERNAME = "spaceinvasion"; // deve combaciare con "user=" in turn/turnserver.conf
const TURN_CREDENTIAL = "SaraFranci1816"; // deve combaciare con la password dopo i due punti in "user=...:PASSWORD"

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

// ---------------------------------------------------------------------------------------------
// 1v1: costanti della partita competitiva a punteggio (arena condivisa). L'AUTORITA' su queste
// regole (quando finisce la partita, quante vite, i tempi di respawn) e' passata interamente al
// server dell'arena (vedi arena-server/simulation.js, che ha la sua copia di questi stessi
// valori): il client non decide piu' nulla di tutto questo, si limita a mostrare quello che il
// server comunica in ogni ArenaSnapshot/ArenaMatchResult (vedi arena/arenaClient.ts).
//
// Le costanti che restano qui sono quindi solo:
// (a) valori di visualizzazione INIZIALE per l'HUD, prima che arrivi il primo ArenaSnapshot (che
//     porta gia' vite/punteggio reali) - puramente cosmetici, mai usati per decidere alcunche';
// (b) i tempi dell'animazione di "morte"/respawn della PROPRIA navicella (nascondersi, particelle,
//     breve invulnerabilita' visiva), disegnata dal client quando nota che le proprie vite sono
//     scese in un nuovo ArenaSnapshot - anche questa e' pura cosmesi: la vulnerabilita' reale ai
//     fini delle collisioni resta decisa dal server, che ha il proprio timer identico e
//     indipendente. Se il client sbagliasse questi tempi l'unico effetto sarebbe un'animazione
//     leggermente sfasata, mai un risultato di gioco diverso.
// ---------------------------------------------------------------------------------------------

// Vite di ciascuna navicella nella partita manuale - valore mostrato nell'HUD prima del primo
// ArenaSnapshot (vedi sopra). Deve restare uguale a LIVES_PER_PLAYER in arena-server/simulation.js.
export const LIVES_PER_PLAYER = 3;

// Tempo tra la "morte" (perdita di una vita) e il respawn della navicella, in ms - solo per
// l'animazione locale (vedi sopra); deve restare uguale a RESPAWN_DELAY_MS lato server perche' la
// navicella non riappaia visivamente prima o dopo il momento in cui il server la considera di
// nuovo vulnerabile.
export const RESPAWN_DELAY_MS = 2000;

// Durata dell'invulnerabilita' subito dopo il respawn, in ms - idem, solo cosmetico lato client
// (deve restare uguale a RESPAWN_INVULNERABILITY_MS lato server).
export const RESPAWN_INVULNERABILITY_MS = 2000;

// ---------------------------------------------------------------------------------------------
// TESTBED 1v1: regole della partita automatica (solo con "?auto=1", vedi main.ts). Anche qui tutto
// cio' che riguarda QUANDO la partita finisce (eliminazioni, ondate, ritardo finale) e' deciso dal
// server - vedi arena-server/simulation.js. Il client non tiene piu' un proprio stato di
// avanzamento delle ondate: disegna semplicemente gli invasori/asteroidi che l'ultimo
// ArenaSnapshot contiene, qualunque sia l'ondata a cui appartengono.
// ---------------------------------------------------------------------------------------------

// Vite di ciascuna navicella nel testbed (una sola, nessun respawn) - valore mostrato nell'HUD
// prima del primo ArenaSnapshot. Deve restare uguale a TESTBED_LIVES_PER_PLAYER lato server.
export const TESTBED_LIVES_PER_PLAYER = 1;
