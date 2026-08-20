let idCounter = 0;

//funzione di supporto che genera ID univoci per le entità di gioco così da poterle identificare negli snapshot inviati al publisher
//e gestire correttamente le collisioni e gli aggiornamenti dello stato del gioco
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`; //esempio: "proj-1", "invader-3", "asteroid-5"
}
