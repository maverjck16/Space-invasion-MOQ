//definisco costanti globali
export const APP_PREFIX = "space-invasion"; //prefisso di tutti i path MOQ, nel publisher uso
// const path = `${APP_PREFIX}/${room}/${username}`, esempio di path: space-invasion/general/francesco
export const TRACK_GAME = "game"; //nome della track che uso per inviare i dati di digitazione  
export const RELAY_URL = "https://spaceinvasion.ddns.net:4443"; //url del relay, in questo caso è in locale
// export const RELAY_URL = "https://cdn.moq.dev"; //url del relay in remoto
export const TRACK_PRIORITY = 0;
// timeout massimo per l'handshake QUIC/WebTransport verso il relay: se scade, l'errore viene
// mostrato subito invece di aspettare il timeout (molto più lungo) del browser
export const CONNECT_TIMEOUT_MS = 8000;

// frequenza di invio degli snapshot di gioco sulla rete, disaccoppiata dal frame rate di
// rendering (60fps): non ha senso pubblicare più veloce di così, e mantenerla più bassa del
// render riduce banda/backlog senza impattare la fluidità locale
export const NETWORK_TICK_HZ = 25;

// ogni quanto stampare in console le metriche di rete "live" (send/sec, recv/sec, ultimo RTT).
// Il riepilogo completo (avg/min/max/p50/p95/p99 ecc.) viene comunque stampato sempre a fine
// sessione, indipendentemente da questo intervallo - vedi src/metrics/metrics.ts
export const METRICS_LOG_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------------------------
// 1v1: costanti della partita competitiva a punteggio (arena condivisa, vedi LocalGameEngine.ts).
// Identiche nella versione WebRTC (stessa struttura di file), cosi' il confronto resta a parita' di
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

// Handshake di inizio partita (vedi moq/publisher.ts, moq/subscriber.ts e main.ts): chi si scopre
// iniziatore (vedi subscriber.ts per la regola, diversa da quella WebRTC) genera un seed condiviso
// e un istante di partenza comune (Date.now() + questo margine), cosi' entrambi i client hanno il
// tempo di ricevere/applicare il seed e programmare l'avvio del proprio motore locale allo stesso
// istante, prima che scada.
export const MATCH_INIT_LEAD_MS = 1200;

// Il messaggio che porta il matchInit viaggia sulla stessa track "game" gia' esistente, che scarta i
// gruppi vecchi a favore dei piu' recenti (vedi subscriber.ts, readGameTrack): un singolo invio del
// seed potrebbe quindi non essere mai letto se sovrascritto prima che il subscriber lo consumi. Per
// non rischiare che l'intera partita non parta mai, il lato che genera il matchInit continua a
// riallegarlo (idempotente per chi riceve) a ogni gruppo/snapshot in uscita per questa finestra di
// tempo dopo averlo generato, invece che una volta sola - vedi moq/publisher.ts. Va oltre
// MATCH_INIT_LEAD_MS per lasciare qualche tentativo di margine anche dopo l'istante di partenza
// teorico. Dopo la finestra il traffico torna simmetrico tra i due lati per il resto della partita
// (nessun campo extra sugli snapshot), preservando il confronto di banda a regime.
export const MATCH_INIT_RESEND_WINDOW_MS = 2000;

// ---------------------------------------------------------------------------------------------
// TESTBED 1v1: regole della partita automatica (solo con "?auto=1", vedi main.ts). La partita
// manuale continua a usare le costanti qui sopra (timer, vite multiple, respawn) senza differenze.
// Identiche nella versione WebRTC.
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
