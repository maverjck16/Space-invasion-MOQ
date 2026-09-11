let idCounter = 0;

//funzione di supporto che genera ID univoci per le entità di gioco così da poterle identificare negli snapshot inviati al publisher
//e gestire correttamente le collisioni e gli aggiornamenti dello stato del gioco
//
// 1v1: usata SOLO per entità puramente locali/cosmetiche (proiettili del giocatore, particelle),
// che ogni client crea in quantità e momenti diversi dall'altro (es. le particelle dell'esplosione
// della PROPRIA navicella non vengono create anche sul client avversario). Per le entità del campo
// condiviso (invasori/griglie/asteroidi/proiettili nemici) vedi nextArenaId() sotto: usano un
// contatore separato apposta, cosi' la loro sequenza di id resta identica sui due client anche se i
// due contatori "locali" divergono.
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`; //esempio: "proj-1", "invader-3", "asteroid-5"
}

//  1v1: contatore dedicato alla simulazione dell'arena condivisa (Grid/Invader/Asteroid/
// InvaderProjectile - vedi LocalGameEngine.ts), avanzato SOLO da quelle classi. Perche' i due
// client, avviati con lo stesso seed e la stessa sequenza di frame, generino gli stessi id per le
// stesse entita' condivise (necessario per riconciliare le uccisioni via GameSnapshot.killedIds),
// questo contatore deve avanzare in modo identico su entrambi i lati: separarlo dal contatore
// "locale" sopra evita che eventi puramente locali (particelle, proiettili del giocatore) lo
// facciano divergere.
let arenaIdCounter = 0;

export function nextArenaId(prefix: string): string {
  arenaIdCounter += 1;
  return `${prefix}-${arenaIdCounter}`;
}

//  1v1: azzera entrambi i contatori a inizio partita/restart, cosi' una nuova partita (nuovo seed)
// riparte sempre dalla stessa sequenza di id su entrambi i client, invece di continuare da dove
// erano arrivati i contatori della partita precedente (che potrebbero essere diversi tra i due lati
// per via di eventi locali gia' successi prima del reset).
export function resetIdCounters(): void {
  idCounter = 0;
  arenaIdCounter = 0;
}
