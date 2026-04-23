//definisco costanti globali
export const APP_PREFIX = "moq-keycast"; //prefisso di tutti i path MOQ, nel publisher uso
// const path = `${APP_PREFIX}/${room}/${username}`, esempio di path: moq-keycast/general/francesco
export const TRACK_GAME = "game"; //nome della track che uso per inviare i dati di digitazione  
//export const RELAY_URL = "http://localhost:4443"; //url del relay, in questo caso è in locale
export const RELAY_URL = "http://130.136.112.61:4443/anon"; //url del relay in remoto
export const TRACK_PRIORITY = 0; 