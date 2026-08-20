import { defineConfig, type Plugin } from "vite";
import fs from "fs";
import path from "path";

// A differenza della versione MoQ, qui NON servono certificati TLS per lo sviluppo/il confronto
// locale: RTCPeerConnection e RTCDataChannel funzionano su http://localhost anche senza contesto
// sicuro (a differenza di getUserMedia, che qui non serve, non essendoci audio/video). Per un
// deployment pubblico su dominio reale, aggiungere qui la stessa configurazione "https" gia' usata
// in moq-keycast-ts/TS/frontend/vite.config.ts (server.https con key/cert) e passare a wss:// per
// il signaling in src/config.ts.

//  TESTBED: endpoint locale POST /api/report, usato da src/testbed/runLogger.ts per salvare su
// disco (in results/, accanto a questo file) il risultato di ogni run automatico - cosi' eseguire
// N run ripetuti (vedi scripts/run-batch.ps1) non richiede aprire N popup di download del browser.
// Nessuna dipendenza aggiuntiva: usa solo Node "fs"/"path" e l'hook configureServer di Vite.
// Identico, salvo il commento del percorso di log, alla versione in moq-keycast-ts/TS/frontend/vite.config.ts.
function testbedReportEndpoint(): Plugin {
  const resultsDir = path.resolve(import.meta.dirname, "results");

  return {
    name: "testbed-report-endpoint",
    configureServer(server) {
      if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

      server.middlewares.use("/api/report", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const report = JSON.parse(body);
            const safeRunId = String(report.runId ?? "run").replace(/[^a-zA-Z0-9_-]/g, "_");
            const filename = `${safeRunId}-${Date.now()}.json`;
            fs.writeFileSync(path.join(resultsDir, filename), JSON.stringify(report, null, 2));
            console.log(`[testbed] risultato salvato: frontend/results/${filename}`);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, file: filename }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [testbedReportEndpoint()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // TESTBED: consente l'accesso tramite tunnel pubblico (localtunnel) per far vedere/giocare
    // la partita da remoto durante il test manuale - Vite blocca per default gli host sconosciuti.
    allowedHosts: [".loca.lt"],
  },
});
