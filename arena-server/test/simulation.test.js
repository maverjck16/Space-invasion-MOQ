// Test di base per simulation.js. Non verificano ogni singola regola di gioco (per quello resta
// il confronto visivo/manuale con il comportamento originale, gia' fatto durante la scrittura di
// questo modulo): qui controlliamo le proprieta' che l'architettura server-autoritativa deve
// garantire per essere accettabile ai fini della tesi:
//   1) a parita' di seed, due stanze indipendenti producono ESATTAMENTE la stessa sequenza di
//      stati (determinismo dell'unica fonte di verita', non piu' "stesso seed su due client
//      indipendenti" come nella versione contestata dal tutor);
//   2) l'orologio e' davvero iniettabile (nessuna dipendenza nascosta da Date.now/setTimeout reali
//      quando viene fornito un orologio virtuale), condizione necessaria per far girare il testbed
//      offline in modo riproducibile;
//   3) il ciclo di vita di base (join, stato, fuoco, fine partita) non lancia eccezioni e produce
//      snapshot con la forma attesa.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRoom, FRAME_MS, MATCH_DURATION_MS } = require("../simulation");

// Orologio virtuale minimale: avanza solo quando lo chiama esplicitamente il test, cosi' i timer
// di respawn/invulnerabilita' e il countdown della partita "timed" restano deterministici invece
// di dipendere da quanto impiega davvero questo processo a eseguire il test.
function makeVirtualClock(startMs = 0) {
  let now = startMs;
  const pending = []; // { dueAt, fn, id }
  let nextId = 1;
  return {
    now: () => now,
    setTimer: (fn, delayMs) => {
      const id = nextId++;
      pending.push({ id, dueAt: now + delayMs, fn });
      return id;
    },
    clearTimer: (id) => {
      const idx = pending.findIndex((t) => t.id === id);
      if (idx !== -1) pending.splice(idx, 1);
    },
    advance(ms) {
      now += ms;
      // Esegue in ordine di scadenza i timer maturati, cosi' un timer che ne pianifica un altro
      // (non il caso qui, ma per sicurezza) viene comunque considerato.
      for (;;) {
        const due = pending.filter((t) => t.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!due) break;
        pending.splice(pending.indexOf(due), 1);
        due.fn();
      }
    },
  };
}

function runMatch({ seed, matchMode = "timed", ticks = 300, gameConfig = null }) {
  const clock = makeVirtualClock();
  const room = createRoom({
    matchMode,
    gameConfig,
    seed,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  room.addPlayer("Fra");
  room.addPlayer("Luca");
  // Supera il margine di avvio (MATCH_INIT_LEAD_MS-equivalente, 1200ms) prima di ticchettare,
  // cosi' la partita risulta gia' "started" per tutta la simulazione, come nel caso reale in cui
  // il client non manda input prima di matchStart.
  clock.advance(1300);

  const snapshots = [];
  for (let i = 0; i < ticks; i++) {
    room.setPlayerState("Fra", { x: 100 + i, y: 400 });
    room.setPlayerState("Luca", { x: 800 - i, y: 400 });
    if (i === 10) room.fire("Fra", { id: `f-${i}`, x: 110, y: 390, vx: 0, vy: -6, radius: 4 });
    clock.advance(FRAME_MS);
    room.tickOnce();
    snapshots.push(room.getSnapshot());
  }
  room.destroy();
  return { snapshots, isEnded: room.isEnded(), result: room.getResult() };
}

test("a parita' di seed la sequenza di snapshot e' identica bit per bit", () => {
  const a = runMatch({ seed: 42, ticks: 400 });
  const b = runMatch({ seed: 42, ticks: 400 });
  assert.equal(JSON.stringify(a.snapshots), JSON.stringify(b.snapshots));
});

test("seed diversi producono prima o poi una sequenza diversa", () => {
  const a = runMatch({ seed: 1, ticks: 400 });
  const b = runMatch({ seed: 2, ticks: 400 });
  assert.notEqual(JSON.stringify(a.snapshots), JSON.stringify(b.snapshots));
});

test("lo snapshot ha la forma attesa dal client (arena entita' + stato giocatori)", () => {
  const { snapshots } = runMatch({ seed: 7, ticks: 60 });
  const last = snapshots[snapshots.length - 1];
  assert.equal(typeof last.tick, "number");
  assert.equal(typeof last.remainingMs, "number");
  assert.ok(Array.isArray(last.invaders));
  assert.ok(Array.isArray(last.asteroids));
  assert.ok(Array.isArray(last.invaderProjectiles));
  assert.ok(last.players.Fra);
  assert.ok(last.players.Luca);
  assert.equal(typeof last.players.Fra.score, "number");
  assert.equal(typeof last.players.Fra.lives, "number");
  assert.equal(typeof last.players.Fra.eliminated, "boolean");
});

test("la partita 'timed' non risulta conclusa prima della durata configurata", () => {
  // MATCH_DURATION_MS / FRAME_MS = numero di tick di una partita completa: ne eseguiamo molti
  // meno per tenere il test veloce, verificando solo che non finisca troppo presto.
  const ticksWellBeforeEnd = Math.floor(MATCH_DURATION_MS / FRAME_MS / 4);
  const { isEnded } = runMatch({ seed: 3, matchMode: "timed", ticks: ticksWellBeforeEnd });
  assert.equal(isEnded, false);
});

test("tickOnce() e' un no-op prima di startAtEpochMs (il campo condiviso non deve avanzare prima che i client abbiano montato il motore locale)", () => {
  // Regressione: "started" diventa true non appena arriva il secondo giocatore (vedi addPlayer()),
  // ma il client mantiene un margine di ~1200ms (lo stesso startAtEpochMs) prima di costruire il
  // proprio LocalGameEngine (vedi main.ts). Se tickOnce() avanzasse gia' in questa finestra, il
  // server spenderebbe quel secondo abbondante a muovere griglie/asteroidi e a far scorrere
  // scriptedClock/frames a vuoto, disallineando il conteggio frame del server da quello del client
  // (da cui dipendono sia le ondate scriptate del testbed sia testbed/scenarioPlayer.ts).
  const clock = makeVirtualClock();
  const room = createRoom({
    matchMode: "timed",
    seed: 5,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  room.addPlayer("Fra");
  room.addPlayer("Luca");
  const startAt = room.startAtEpochMs();

  // Ticchetta ripetutamente PRIMA che il tempo virtuale raggiunga startAtEpochMs: non deve
  // succedere nulla.
  for (let i = 0; i < 50; i++) {
    room.tickOnce();
    clock.advance(FRAME_MS);
  }
  assert.ok(clock.now() < startAt, "il test presuppone di non aver ancora superato startAtEpochMs");
  const frozen = room.getSnapshot();
  assert.equal(frozen.tick, 0);
  assert.equal(frozen.invaders.length, 0);

  // Supera startAtEpochMs: da qui in poi tickOnce() deve avanzare normalmente.
  while (clock.now() < startAt) clock.advance(FRAME_MS);
  room.tickOnce();
  clock.advance(FRAME_MS);
  const afterStart = room.getSnapshot();
  assert.equal(afterStart.tick, 1);

  room.destroy();
});

test("l'orologio iniettato e' l'unica fonte di tempo (nessuna avanzamento senza chiamare advance)", () => {
  const clock = makeVirtualClock();
  const room = createRoom({ matchMode: "timed", seed: 99, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  room.addPlayer("Fra");
  room.addPlayer("Luca");
  const startAt = room.startAtEpochMs();
  // Senza avanzare l'orologio virtuale, startAtEpochMs deve restare fisso: se dipendesse da
  // Date.now() reale invece che dall'orologio iniettato, due letture a distanza di tempo reale
  // diverso (il tempo che il test runner impiega fra le due righe) potrebbero differire.
  assert.equal(room.startAtEpochMs(), startAt);
  room.destroy();
});
