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