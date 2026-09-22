// Costanti globali. Struttura speculare a moq-keycast-ts/TS/frontend/src/config.ts, cosi' il
// confronto tra le due implementazioni resta diretto voce per voce.

// URL del server di signaling WebSocket (equivalente, per la sola fase di rendez-vous, del
// RELAY_URL della versione MoQ). Il traffico di gioco NON passa da qui: vedi src/webrtc/peerManager.ts.
export const SIGNALING_URL = "ws://34.154.34.239:8080"; // schema di porte della VM GCP attuale (vedi deploy/DEPLOY.md): 8080 signaling, 8081 frontend, 3478 TURN, cosi' da non confliggere con le porte 443/4443 gia' usate dal relay MoQ sulla stessa macchina
// export const SIGNALING_URL = "ws://localhost:8080"; // sviluppo locale
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
// TURN attivo: coturn (vedi turn/turnserver.conf, listening-port=3478) gira sulla stessa VM del
// signaling/frontend, secondo lo schema di porte di deploy/DEPLOY.md (8080 signaling, 8081
// frontend, 3478 TURN, 49152-49452 UDP per il traffico relayato), scelto apposta per non
// confliggere con le porte 443/4443 gia' usate dal relay MoQ sulla stessa macchina. Serve che
// queste porte siano aperte in ingresso sul firewall/VPC della VM (vedi deploy/DEPLOY.md punto 3).
const TURN_URL = "turn:34.154.34.239:3478"; // es. "turns:dominio:5349" per TLS
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
// 1v1: costanti della partita competitiva a punteggio (arena condivisa, vedi LocalGameEngine.ts).
// Identiche nella versione MoQ (stessa struttura di file), cosi' il confronto resta a parita' di
// regole di gioco, non solo di trasporto.
// ---------------------------------------------------------------------------------------------

// Durata di una partita: allo scadere, il motore si ferma e vince chi ha piu' punti (a parita',
// pareggio). 3 minuti di default - facilmente regolabile per gli esperimenti.
export const MATCH_DURATION_MS = 3 * 60 * 1000;

// Vite di ciascuna navicella: colpita da invasore/asteroide/proiettile nemico, respawna invece di
// terminare subito la partita; esaurite le vite la navicella resta fuori gioco (non piu' pilotabile
// ne' collidibile) ma l'arena condivisa continua a girare per l'altro giocatore fino al timer.
export const LIVES_PER_PLAYER = 3;

// Tempo tra la "morte" (perdita di una vita) e il respawn della navicella, in ms - riuso dello
// stesso ritardo gia' presente nella versione originale (playerDeath, LocalGameEngine.ts) prima di
// mostrare la schermata di game over.
export const RESPAWN_DELAY_MS = 2000;

// Durata dell'invulnerabilita' subito dopo il respawn, in ms - evita di rimorire istantaneamente
// se si respawna in mezzo a una minaccia gia' presente sullo schermo.
export const RESPAWN_INVULNERABILITY_MS = 2000;

// Handshake di inizio partita (vedi webrtc/peerManager.ts e main.ts): chi si accorge per ultimo
// della presenza dell'altro genera un seed condiviso e un istante di partenza comune
// (Date.now() + questo margine), cosi' entrambi i client hanno il tempo di ricevere/applicare il
// seed e programmare l'avvio del proprio motore locale allo stesso istante, prima che scada.
export const MATCH_INIT_LEAD_MS = 1200;

// Il messaggio che porta il matchInit viaggia sullo stesso canale/track "game" gia' esistente, che
// e' inaffidabile per design (WebRTC: DataChannel "unordered, maxRetransmits:0" - vedi
// peerManager.ts; MoQ: i gruppi vecchi vengono scartati a favore dei piu' recenti - vedi
// subscriber.ts): un singolo invio del seed potrebbe quindi perdersi. Per non rischiare che
// l'intera partita non parta mai per un pacchetto perso, il lato che genera il matchInit continua
// a riallegarlo (idempotente per chi riceve) a ogni snapshot in uscita per questa finestra di
// tempo dopo averlo generato, invece che una volta sola - vedi peerManager.ts/moq/publisher.ts.
// Va oltre MATCH_INIT_LEAD_MS per lasciare qualche tentativo di margine anche dopo l'istante di
// partenza teorico. Dopo la finestra il traffico torna simmetrico tra i due lati per il resto della
// partita (nessun campo extra sugli snapshot), preservando il confronto di banda a regime.
export const MATCH_INIT_RESEND_WINDOW_MS = 2000;

// ---------------------------------------------------------------------------------------------
// TESTBED 1v1: regole della partita automatica (solo con "?auto=1", vedi main.ts). La partita
// manuale continua a usare le costanti qui sopra (timer, vite multiple, respawn) senza differenze.
// Identiche nella versione MoQ.
// ---------------------------------------------------------------------------------------------

// Vite di ciascuna navicella nel testbed: una sola, quindi nessun respawn. Chi viene colpito resta
// fuori gioco e l'avversario continua a giocare (vedi LocalGameEngine.updateTestbedMatchState).
export const TESTBED_LIVES_PER_PLAYER = 1;

// Nel testbed non c'e' un timer di partita: la partita termina quando entrambe le navicelle sono
// state eliminate oppure questo intervallo dopo l'eliminazione dell'ultima ondata scriptata.
export const TESTBED_END_DELAY_AFTER_LAST_WAVE_MS = 3000;

// Tempo massimo di attesa dello stato finale dell'avversario dopo che questo client ha chiuso la
// propria partita. Di norma arriva con lo snapshot successivo (qualche decina di ms): il limite
// serve solo a non restare bloccati se l'avversario si disconnette proprio in quel momento.
export const TESTBED_FINAL_STATE_TIMEOUT_MS = 5000;

// Pausa tra l'eliminazione di un'ondata scriptata e la comparsa della successiva. Oltre a separare
// le fasi, assorbe la latenza di rete: l'ondata successiva compare nello stesso frame di gioco su
// entrambi i client (vedi LocalGameEngine.updateTestbedWaves()), purche' l'informazione
// "ondata eliminata" arrivi all'altro client entro questo intervallo.
export const TESTBED_WAVE_SPAWN_DELAY_MS = 1000;
