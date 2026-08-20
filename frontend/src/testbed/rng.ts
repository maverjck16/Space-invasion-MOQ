//  Generatore di numeri pseudo-casuali deterministico (seedato), usato dal testbed per rendere
// riproducibile ogni sorgente di casualita' del gioco (spawn di asteroidi/griglie di invasori,
// particelle, scelta dell'invasore che spara, ecc.).
//
//  IMPORTANTE: questo modulo NON modifica in alcun modo la logica di gioco. "grep -rn
// 'Math.random' src/" nell'intero progetto mostra che l'UNICA fonte di casualita' e' Math.random(),
// usata solo in game/localGame/LocalGameEngine.ts, game/localGame/entities/Grid.ts e
// game/localGame/entities/Asteroid.ts (file copiati verbatim dalla versione originale, identici
// byte-per-byte tra il testbed MoQ e quello WebRTC). Installare qui un generatore seedato al posto
// del Math.random nativo del browser rende l'intero gioco deterministico con una singola riga,
// senza toccare nessuno di quei file.
//
//  Algoritmo: mulberry32 (dominio pubblico), PRNG a 32 bit non crittografico - non serve che lo
// sia qui - scelto perche' piccolo, veloce, senza dipendenze esterne, con distribuzione più che
// sufficiente per posizioni/tempi di spawn.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const originalMathRandom = Math.random.bind(Math);

//  Sostituisce globalmente Math.random con un generatore seedato. Va chiamata il prima possibile,
// PRIMA di costruire qualunque LocalGameEngine: Math.random() viene gia' chiamato negli
// inizializzatori dei campi della classe, cioe' nell'istante stesso della "new LocalGameEngine(...)".
export function installDeterministicRandom(seed: number): void {
  Math.random = mulberry32(seed);
}

//  Ripristina il Math.random nativo del browser (utile per tornare a un comportamento non
// deterministico, es. durante debug manuale fuori da un run automatico).
export function restoreNativeRandom(): void {
  Math.random = originalMathRandom;
}
