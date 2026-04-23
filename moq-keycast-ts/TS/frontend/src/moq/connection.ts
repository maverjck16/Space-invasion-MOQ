//Questo file gestisce la connessione al relay utilizzando il pacchetto @moq/lite. Si occupa di stabilire la
//connessione, mantenerla attiva e gestire la disconnessione quando necessario. 

import * as Moq from "@moq/lite"; //installo il pacchetto @moq/lite per la connessione al relay
import { install as installWebTransportPolyfill } from "@moq/web-transport-ws";
import { RELAY_URL } from "../config"; //importo l'url del relay dal file di configurazione

// Installa un polyfill WebTransport (basato su WebSocket) quando il browser non lo supporta nativamente.
installWebTransportPolyfill();

//Moq.Connection.connect restituisce una Promise che quando risolta fornisce un oggetto di tipo MoqConnection, 
// che rappresenta la connessione al relay.
export type MoqConnection = Awaited<ReturnType<typeof Moq.Connection.connect>>;


//memorizzo la connessione relay in una variabile globale per poterla riutilizzare 
let connection: MoqConnection | null = null;

//funzione per connettersi al relay, se la connessione esiste già viene restituita, altrimenti ne viene creata una
//nuova
export async function connectToRelay(): Promise<MoqConnection> {
  if (connection) return connection;

  const url = new URL(RELAY_URL);
  //connetto al relay usando l'url specificato e memorizzo la connessione nella variabile globale
  connection = await Moq.Connection.connect(url);

  //gestisco la chiusura della connessione, quando la connessione viene chiusa,la variabile connection
  //viene impostata a null
  connection.closed.then(() => {
    connection = null;
  });

  return connection;
}

//funzione per ottenere la connessione al relay, se la connessione non è stata inizializzata viene lanciato un errore
export function getConnection(): MoqConnection {
  if (!connection) {
    throw new Error("Connessione non inizializzata");
  }
  return connection;
}

//funzione per disconnettersi dal relay, se la connessione esiste viene chiusa e la variabile connection viene
//  impostata a null
export function disconnectFromRelay(): void {
  if (!connection) return;
  connection.close();
  connection = null;
}