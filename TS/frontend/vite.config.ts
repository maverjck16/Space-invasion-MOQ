import { defineConfig, type Plugin } from "vite";
import fs from "fs";
import path from "path";

const KEY_PATH = "/etc/letsencrypt/live/spaceinvasion.ddns.net/privkey.pem";
const CERT_PATH = "/etc/letsencrypt/live/spaceinvasion.ddns.net/fullchain.pem";

function readTlsFile(path: string): Buffer {
  try {
    return fs.readFileSync(path);
  } catch (err) {
    throw new Error(
      `Impossibile leggere il certificato TLS in "${path}". ` +
        `Verifica che /etc/letsencrypt sia montato nel container e che il certificato per ` +
        `spaceinvasion.ddns.net esista. Errore originale: ${(err as Error).message}`
    );
  }
}

//  TESTBED: endpoint locale POST /api/report, usato da src/testbed/runLogger.ts per salvare su
// disco (in results/, accanto a questo file) il risultato di ogni run automatico - cosi' eseguire
// N run ripetuti (vedi scripts/run-batch.ps1) non richiede aprire N popup di download del browser.
// Nessuna dipendenza aggiuntiva: usa solo Node "fs"/"path" e l'hook configureServer di Vite.
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
            console.log(`[testbed] risultato salvato: TS/frontend/results/${filename}`);
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
    port: 443,
    strictPort: true,
    https: {
      key: readTlsFile(KEY_PATH),
      cert: readTlsFile(CERT_PATH),
    },
    hmr: {
      clientPort: 443,
      host: "spaceinvasion.ddns.net"
    }
  },
});
