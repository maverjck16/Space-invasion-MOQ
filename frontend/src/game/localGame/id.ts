let idCounter = 0;

//funzione di supporto che genera ID univoci per le entità LOCALI (proiettili della propria
//navicella, particelle): non identificano piu' nulla di condiviso con l'avversario, servono solo
//a distinguere gli oggetti dentro l'array di questo stesso client.
//
// 1v1 - server autoritativo: il vecchio "contatore dell'arena" (nextArenaId/resetIdCounters), che
// doveva avanzare in modo identico sui due client perche' entrambi simulavano in locale la stessa
// arena condivisa con lo stesso seed, non esiste piu': gli id di invasori/asteroidi/proiettili
// nemici sono ora generati UNA SOLA VOLTA dal server dell'arena (vedi arena-server/simulation.js,
// nextArenaId() li') e arrivano gia' pronti in ogni ArenaSnapshot - il client li usa solo come
// chiave per il proprio render cache (vedi game/localGame/entities/ArenaEntities.ts), non ha piu'
// alcun bisogno di generarli.
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`; //esempio: "proj-1", "particle-3"
}
