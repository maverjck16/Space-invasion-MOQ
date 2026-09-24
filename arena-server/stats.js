// Statistiche di carico del server dell'arena, per stanza. Modulo di sola osservazione: non
// modifica la simulazione (simulation.js) ne' il protocollo (server.js), si limita a misurare
// quanto costa al server tenere in vita una partita 1v1, cosi' che il carico aggiunto
// dall'arena autoritativa sia confrontabile con quello del canale P2P misurato dai client
// (vedi frontend/src/metrics/metrics.ts).
//
// Per ogni stanza raccoglie, con finestre da 1 s a partire dall'inizio della partita:
//   - tempo di esecuzione di tickOnce() (media e massimo), da confrontare con FRAME_MS (16.67 ms),
//     che e' il budget disponibile per ogni passo di simulazione a 60 Hz;
//   - utilizzo di CPU dell'intero processo (100% = un core), misurato con process.cpuUsage();
//   - numero di entita' simulate (invasori + asteroidi + proiettili nemici) all'ultimo broadcast;
//   - byte e messaggi inviati/ricevuti sui WebSocket della stanza.
// Al termine della partita scrive un riepilogo in console (una riga JSON con prefisso
// "[arena-stats]", recuperabile con "docker logs") e, se ARENA_STATS_DIR e' impostata, un file
// JSON con la serie temporale completa.

const fs = require("fs");
const path = require("path");

const STATS_DIR = process.env.ARENA_STATS_DIR;
const WINDOW_MS = 1000;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function createRoomStats(roomName) {
  let started = false;
  let listener = null;
  let finished = false;
  let startedAtMs = 0;
  let windowTimer = null;

  const tickSamplesMs = [];
  const windows = [];

  let winTickCount = 0;
  let winTickSumMs = 0;
  let winTickMaxMs = 0;
  let winBytesOut = 0;
  let winBytesIn = 0;
  let winMsgsOut = 0;
  let winMsgsIn = 0;
  let lastEntities = 0;
  let lastCpu = process.cpuUsage();
  let lastWallMs = 0;

  let totalBytesOut = 0;
  let totalBytesIn = 0;
  let totalMsgsOut = 0;
  let totalMsgsIn = 0;
  let maxEntities = 0;

  function closeWindow() {
    const now = Date.now();
    const wallMs = Math.max(1, now - lastWallMs);
    const cpu = process.cpuUsage(lastCpu);
    const win = {
      t: Number(((now - startedAtMs) / 1000).toFixed(1)),
      tickAvgMs: winTickCount ? winTickSumMs / winTickCount : 0,
      tickMaxMs: winTickMaxMs,
      ticks: winTickCount,
      cpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100,
      entities: lastEntities,
      bytesOut: winBytesOut,
      bytesIn: winBytesIn,
      msgsOut: winMsgsOut,
      msgsIn: winMsgsIn,
    };
    windows.push(win);
    listener?.({ kind: "window", window: win });
    lastCpu = process.cpuUsage();
    lastWallMs = now;
    winTickCount = 0;
    winTickSumMs = 0;
    winTickMaxMs = 0;
    winBytesOut = 0;
    winBytesIn = 0;
    winMsgsOut = 0;
    winMsgsIn = 0;
  }

  return {
    // Registra una funzione chiamata a ogni finestra chiusa e al riepilogo finale: server.js la usa
    // per inoltrare le statistiche ai client, che le inseriscono nel file JSON delle metriche.
    setListener(fn) {
      listener = fn;
    },

    // Da chiamare quando partono i loop della stanza (secondo giocatore entrato).
    start() {
      if (started) return;
      started = true;
      startedAtMs = Date.now();
      lastWallMs = startedAtMs;
      lastCpu = process.cpuUsage();
      windowTimer = setInterval(closeWindow, WINDOW_MS);
      windowTimer.unref?.();
    },

    // Esegue un passo di simulazione misurandone la durata reale.
    timeTick(fn) {
      if (!started) return fn();
      const t0 = process.hrtime.bigint();
      const result = fn();
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      tickSamplesMs.push(ms);
      winTickCount++;
      winTickSumMs += ms;
      if (ms > winTickMaxMs) winTickMaxMs = ms;
      return result;
    },

    onSent(bytes) {
      totalBytesOut += bytes;
      totalMsgsOut++;
      winBytesOut += bytes;
      winMsgsOut++;
    },

    onReceived(bytes) {
      totalBytesIn += bytes;
      totalMsgsIn++;
      winBytesIn += bytes;
      winMsgsIn++;
    },

    sampleEntities(count) {
      lastEntities = count;
      if (count > maxEntities) maxEntities = count;
    },

    // Chiude la raccolta e emette il riepilogo. Idempotente.
    finish() {
      if (!started || finished) return;
      finished = true;
      if (windowTimer) clearInterval(windowTimer);
      closeWindow();

      const durationSec = (Date.now() - startedAtMs) / 1000;
      const sorted = [...tickSamplesMs].sort((a, b) => a - b);
      const cpuVals = windows.map((w) => w.cpuPercent);
      const summary = {
        room: roomName,
        durationSec,
        tickCount: tickSamplesMs.length,
        tickAvgMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
        tickP95Ms: percentile(sorted, 95),
        tickP99Ms: percentile(sorted, 99),
        tickMaxMs: sorted.length ? sorted[sorted.length - 1] : null,
        cpuPercentAvg: cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : null,
        cpuPercentMax: cpuVals.length ? Math.max(...cpuVals) : null,
        maxEntities,
        bytesOut: totalBytesOut,
        bytesIn: totalBytesIn,
        msgsOut: totalMsgsOut,
        msgsIn: totalMsgsIn,
        bandwidthOutBytesPerSec: totalBytesOut / durationSec,
        bandwidthInBytesPerSec: totalBytesIn / durationSec,
      };

      console.log(`[arena-stats] ${JSON.stringify(summary)}`);
      listener?.({ kind: "summary", summary });

      if (STATS_DIR) {
        try {
          fs.mkdirSync(STATS_DIR, { recursive: true });
          const file = path.join(
            STATS_DIR,
            `arena-stats-${roomName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
          );
          fs.writeFileSync(file, JSON.stringify({ summary, windows }, null, 2));
          console.log(`[arena-stats] serie temporale scritta in ${file}`);
        } catch (err) {
          console.warn("[arena-stats] impossibile scrivere il file delle statistiche:", err.message);
        }
      }
    },
  };
}

module.exports = { createRoomStats };
