//  Hash deterministico e sincrono (FNV-1a a 32 bit) accumulato su ogni GameSnapshot emesso durante
// un run scriptato (vedi ScenarioPlayer/LocalGameEngine), per dimostrare che due run corrispondenti
// (stesso scenarioId/player, quindi stesso seed+timeline, motore di gioco byte-identico tra i due
// testbed - vedi TESTBED.md) hanno eseguito ESATTAMENTE la stessa sequenza di eventi di gioco
// (spawn/evoluzione griglie e asteroidi, proiettili, collisioni, morti, punteggio) - non solo lo
// stesso risultato finale (gia' verificato, ma solo a fine partita, da determinism.ts).
//
//  Confronto atteso: stateSequenceHash("Mock", scenario A, player A) === stateSequenceHash
// ("WebRTC", scenario A, player A) e lo stesso per B - mentre A e B, avendo timeline di input
// diverse, devono produrre hash diversi tra loro (vedi TESTBED.md, "I 3 scenari").
//
//  Perche' non un digest crittografico: qui serve solo confrontare due sequenze prodotte dallo
// STESSO codice con lo STESSO seed, non difendersi da un avversario - FNV-1a e' sincrono (niente
// SubtleCrypto asincrono da coordinare con l'emissione degli snapshot, che gira a
// NETWORK_TICK_HZ=25/s), a 32 bit (basta per rilevare QUALUNQUE divergenza di gameplay, non serve
// resistenza alle collisioni) e a costo trascurabile per uno scenario di 45-60s.
//
//  Vive in src/testbed/ (cartella gia' condivisa byte-per-byte tra i due testbed, vedi TESTBED.md)
// e non importa il tipo GameSnapshot (che vive in due percorsi diversi nei due progetti - vedi
// webrtc/snapshot.ts / moq/publisher.ts): accetta "unknown" cosi' questo file resta identico nei
// due progetti senza bisogno dell'unica riga di import-di-tipo che gia' differenzia
// LocalGameEngine.ts.

function fnv1a(str: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Arrotonda i numeri in virgola mobile a una precisione fissa prima di serializzare, cosi' un
// rumore di floating point sotto la soglia di rilevanza per il gameplay (es. differenze nell'ultimo
// bit dovute a un ordine leggermente diverso delle operazioni aritmetiche, che non cambiano MAI il
// comportamento osservabile del gioco) non fa fallire il confronto per un falso positivo. Le chiavi
// vengono ordinate per rendere la serializzazione indipendente dall'ordine di inserimento delle
// proprieta' nell'oggetto (che in JS e' comunque stabile, ma cosi' il confronto resta robusto anche
// a refactor futuri che cambino l'ordine di costruzione dello snapshot).
const ROUND_DECIMALS = 3;

function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value;
    const factor = 10 ** ROUND_DECIMALS;
    return Math.round(value * factor) / factor;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;

export class StateSequenceHasher {
  private runningHash = FNV_OFFSET_BASIS;
  private tickCount = 0;

  //  Alimenta un nuovo snapshot nella sequenza, aggiornando l'hash cumulativo (l'hash del passo N
  // dipende da quello del passo N-1, quindi anche uno scambio nell'ORDINE di due snapshot altrimenti
  // identici cambia il risultato finale - correttamente, dato che l'ordine e' parte del workload).
  push(snapshot: unknown): void {
    const canonical = JSON.stringify(canonicalize(snapshot));
    this.runningHash = fnv1a(canonical, this.runningHash);
    this.tickCount += 1;
  }

  result(): { stateSequenceHash: string; stateSequenceTickCount: number } {
    return {
      stateSequenceHash: this.runningHash.toString(16).padStart(8, "0"),
      stateSequenceTickCount: this.tickCount,
    };
  }
}
