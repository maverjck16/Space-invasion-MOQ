import * as Moq from "@moq/lite";
import { RELAY_URL, CONNECT_TIMEOUT_MS } from "../config";

export type MoqConnection = Awaited<ReturnType<typeof Moq.Connection.connect>>;

let connection: MoqConnection | null = null;

//  @moq/lite di default fa una "race" fra WebTransport (QUIC) e WebSocket, usando la prima
// che risponde. Per misurare le prestazioni di QUIC dobbiamo usare SOLO WebTransport: se il
// fallback restasse abilitato, una connessione QUIC rotta potrebbe comunque "funzionare" via
// WebSocket senza che ce ne accorgiamo, falsando sia il debug che le misure di latenza.
function connectWithTimeout(url: URL): Promise<MoqConnection> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `Timeout QUIC/WebTransport (${CONNECT_TIMEOUT_MS / 1000}s) verso ${url}. ` +
            `La porta UDP del relay potrebbe non essere raggiungibile (NAT/firewall/router).`
        )
      );
    }, CONNECT_TIMEOUT_MS);
  });

  return Promise.race([
    Moq.Connection.connect(url, { websocket: { enabled: false } }),
    timeout,
  ]);
}

export async function connectToRelay(): Promise<MoqConnection> {
  if (connection) {
    return connection;
  }

  if (!window.WebTransport) {
    throw new Error(
      "WebTransport non supportato da questo browser: impossibile usare MOQ/QUIC."
    );
  }

  const url = new URL(RELAY_URL);

  if (url.protocol !== "https:") {
    throw new Error(
      `RELAY_URL deve usare HTTPS per WebTransport/QUIC. Valore attuale: ${RELAY_URL}`
    );
  }

  try {
    connection = await connectWithTimeout(url);

    connection.closed
      .then(() => {
        connection = null;
      })
      .catch(() => {
        connection = null;
      });

    return connection;
  } catch (error) {
    connection = null;
    console.error("Errore connessione MoQ/WebTransport:", error);
    throw error;
  }
}

export function getConnection(): MoqConnection {
  if (!connection) {
    throw new Error("Connessione MoQ non inizializzata");
  }

  return connection;
}

export function isConnected(): boolean {
  return connection !== null;
}

export function disconnectFromRelay(): void {
  if (!connection) {
    return;
  }

  try {
    connection.close();
  } finally {
    connection = null;
  }
}