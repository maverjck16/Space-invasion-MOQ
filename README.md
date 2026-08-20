# Space Invasion — versione WebRTC

Controparte sperimentale di **[`Space-invasion-MOQ-provaF/moq-keycast-ts`](../Space-invasion-MOQ-provaF/moq-keycast-ts)**, realizzata per confrontare due tecnologie di comunicazione real-time — **MoQ (Media over QUIC)** e **WebRTC** — a parità di applicazione, logica di gioco e workload di rete.

Questo progetto è **completamente indipendente**: non modifica, non importa e non dipende dai sorgenti del progetto MoQ. L'unica cosa condivisa è la logica di gioco (copiata 1:1, vedi sotto) e il payload applicativo (`GameSnapshot`).

Il gioco è invariato: uno space-invaders 1v1 in cui ciascun client simula la propria partita in locale (60fps, canvas 2D) e trasmette periodicamente il proprio stato all'altro giocatore, che lo vede renderizzato "a specchio" nel pannello destro. Non esiste un server autoritativo: ogni client è sorgente di verità solo per la propria partita.

---

## 1. Cos'è questa implementazione

- Stessa logica di gioco, stessa UI, stesso protocollo applicativo (stessi campi, stessa frequenza di invio, stesso meccanismo di metriche) della versione MoQ.
- Cambia **solo** il trasporto: al posto di un relay MoQ su QUIC/WebTransport, qui i due browser si scambiano lo stato di gioco **direttamente** via `RTCDataChannel`, dopo essersi scoperti tramite un piccolo **server di signaling** WebSocket scritto per l'occasione (necessario perché WebRTC richiede comunque un canale iniziale per scambiare SDP/ICE — non esiste un equivalente "senza signaling").
- Il server di signaling instrada **solo** messaggi di controllo (join/leave, offerte/risposte SDP, candidati ICE): il traffico di gioco vero e proprio (`GameSnapshot`) non passa mai da lì, esattamente come richiesto per rendere il confronto significativo.

## 2. Installazione delle dipendenze

Prerequisiti: Node.js 18+ (testato con Node 24) e npm.

```bash
cd Space-invasion-WebRTC-provaF
npm run install:all
```

Questo esegue `npm install` sia in `signaling/` (dipendenza: [`ws`](https://www.npmjs.com/package/ws)) sia in `frontend/` (Vite + TypeScript, nessuna libreria WebRTC esterna: si usano le API native del browser `RTCPeerConnection`/`RTCDataChannel`). Il `package.json` di root ha anche una devDependency (`concurrently`) per avviare i due processi insieme; è già installata dal comando sopra tramite `npm install` sulla root (eseguito automaticamente se lanci prima `npm install` senza prefisso, altrimenti va lanciato anche quello una volta: `npm install`).

In pratica, dalla cartella `Space-invasion-WebRTC-provaF`:

```bash
npm install          # installa concurrently nella root
npm run install:all  # installa signaling/ e frontend/
```

Non servono certificati TLS né configurazioni particolari per l'uso locale (vedi sezione 12).

## 3. Avvio di tutti i componenti

Avvio combinato (consigliato):

```bash
npm run dev
```

Avvia in parallelo il server di signaling e il dev server Vite del frontend, con output colorato e prefissato per distinguerli.

Avvio separato (due terminali):

```bash
npm run dev:signaling   # terminale 1
npm run dev:frontend    # terminale 2
```

## 4. Porte utilizzate

| Componente          | Porta | Protocollo | Note |
|----------------------|-------|------------|------|
| Server di signaling  | 8080  | WebSocket (`ws://`) | Solo join/leave/SDP/ICE. Configurabile con `SIGNALING_PORT` (env) lato server e `SIGNALING_URL` in `frontend/src/config.ts` lato client. |
| Frontend (Vite dev)  | 5173  | HTTP        | `npm run dev --prefix frontend` (`vite.config.ts`). |
| RTCDataChannel "game"| dinamica (negoziata via ICE) | UDP/DTLS/SCTP | Traffico di gioco peer-to-peer, non passa dal server. |

## 5. Prova con due client

1. `npm run dev` dalla root del progetto.
2. Apri **due schede/browser** su `http://localhost:5173` (va bene anche lo stesso browser, due tab — a differenza di WebRTC "reale" con webcam non ci sono conflitti di device).
3. Nella prima scheda: nome pilota `alice`, room `test1` → GIOCA.
4. Nella seconda scheda: nome pilota `bob`, stessa room `test1` → GIOCA.
5. Dopo pochi istanti la barra di stato passa da "In attesa di un altro player..." a "Connesso con ...". Muovendoti (WASD) e sparando (SPAZIO) in una scheda, l'altra mostra il tuo avatar/i tuoi proiettili nel pannello "GIOCO AVVERSARIO".
6. Il pulsante **ESPORTA METRICHE** in alto scarica un JSON e un CSV con RTT/jitter/perdite/byte della sessione (vedi `frontend/src/metrics/metrics.ts`).
7. Chiudendo una scheda o premendo **ESCI**, l'altro client torna in "In attesa di un altro player..." entro pochi secondi.

Per testare su due dispositivi reali sulla stessa LAN: usa l'indirizzo di rete stampato da Vite (es. `http://192.168.x.x:5173`) e imposta `SIGNALING_URL` in `config.ts` sull'IP della macchina che fa da signaling, oppure passa dallo stesso host per entrambi.

## 6. Componenti che usano WebRTC

- `frontend/src/webrtc/connection.ts` — connessione al server di signaling (join room, invio/ricezione di segnali SDP/ICE). Non è WebRTC in sé, ma il canale di rendez-vous che lo rende possibile (equivalente, per questo solo scopo, di `moq/connection.ts`).
- `frontend/src/webrtc/peerManager.ts` — cuore dell'implementazione: crea una `RTCPeerConnection` per ciascun peer della room, apre un `RTCDataChannel` "game" bidirezionale, gestisce la negoziazione (offer/answer/ICE trickle), invia/riceve gli snapshot, aggiorna la presenza.
- `frontend/src/webrtc/publisher.ts` / `subscriber.ts` — facciate sottili su `peerManager.ts` con la stessa interfaccia (`startPublisher`, `publishSnapshot`, `startSubscriber`, ...) dei moduli MoQ originali, per rendere `main.ts` speculare tra le due versioni.
- `signaling/server.js` — **non** usa WebRTC: è puro WebSocket, gioca il ruolo di rendez-vous/presenza (l'equivalente del "control-plane" del relay MoQ), mai quello di trasporto dati di gioco.

## 7 & 8. DataChannel creati e loro configurazione

Un solo DataChannel per coppia di peer, chiamato **`"game"`**, creato dal lato che si è unito per ultimo alla room (`pc.createDataChannel(...)`, vedi `peerManager.ts`):

```ts
pc.createDataChannel("game", {
  ordered: false,       // consegna non ordinata: niente head-of-line blocking
  maxRetransmits: 0,    // nessuna ritrasmissione: "spara e dimentica", stile UDP/datagram
});
```

| Parametro | Valore | Motivazione |
|---|---|---|
| `ordered` | `false` | Ogni `GameSnapshot` è un'istantanea **completa e autosufficiente** dello stato di gioco: uno snapshot più recente rende irrilevante uno più vecchio arrivato dopo. Aspettare l'ordine servirebbe solo a introdurre latenza inutile. |
| `maxRetransmits` | `0` | Se uno snapshot si perde, quello successivo (25 volte al secondo) lo sostituisce comunque: non ha senso ritrasmettere dati ormai obsoleti. Questo è il canale SCTP "best effort", l'equivalente WebRTC più vicino a un datagramma UDP. |
| `maxPacketLifeTime` | non impostato (mutuamente esclusivo con `maxRetransmits`) | Si è scelto un limite sul numero di ritrasmissioni (0) anziché sul tempo, perché è la scelta più diretta per esprimere "mai ritrasmettere" — con un solo tick di rete ogni 40ms i due criteri sarebbero comunque quasi equivalenti in pratica. |

Non sono stati creati canali aggiuntivi: il protocollo applicativo originale ha un'unica track (`TRACK_GAME`) con un'unica semantica ("ultimo vince"), quindi un solo DataChannel per peer riproduce fedelmente l'architettura MoQ senza introdurre distinzioni che nel progetto originale non esistono. Vedi sezione 12 per la discussione sulla differenza di affidabilità reale.

## 9. Come vengono trasferiti gli snapshot

Identico, byte per byte nel formato applicativo, alla versione MoQ:

1. `LocalGameEngine` (copiato invariato da `moq-keycast-ts`) genera un `GameSnapshot` completo (player, proiettili, invasori, asteroidi, particelle, punteggio, stato) ogni `1000/NETWORK_TICK_HZ` ms, **25 volte al secondo**, indipendentemente dal framerate di rendering (60fps).
2. `peerManager.ts` avvolge lo snapshot in un `NetEnvelope` (`{v, seq, tSent, echoSeq?, echoTSent?, payload}}`, identico a `moq/publisher.ts`) e lo serializza una sola volta in JSON.
3. Il JSON viene inviato come `ArrayBuffer` su `channel.send(bytes)` a **ciascun peer con canale "game" aperto** (mesh: se la room avesse più di 2 giocatori, ognuno riceverebbe lo snapshot di tutti gli altri, esattamente come nella versione MoQ con `activeGameTracks`).
4. Alla ricezione, `channel.onmessage` decodifica il JSON, registra le metriche (`recordReceived`) e invoca la stessa callback `onGameUpdate` usata dalla versione MoQ per aggiornare il rendering del giocatore remoto.
5. Alla primissima apertura del canale, viene inviato subito uno snapshot "vuoto" (`createEmptySnapshot()`), equivalente al primo gruppo scritto da `serveTrackRequests()` nella versione MoQ quando arriva una nuova sottoscrizione.

## 10. Altri tipi di messaggi

Oltre allo snapshot di gioco (unico "tipo" applicativo esistente anche nella versione MoQ), l'implementazione WebRTC ha bisogno di messaggi di **signaling**, che non hanno equivalente diretto nel protocollo applicativo MoQ (lì la scoperta dei peer è parte del protocollo del relay). Viaggiano su WebSocket, mai su DataChannel:

| Messaggio | Direzione | Scopo |
|---|---|---|
| `join` | client → server | Entra in una room con un dato username. |
| `joined` | server → client | Conferma + elenco dei peer già presenti nella room. |
| `peer-joined` / `peer-left` | server → client | Notifica presenza (equivalente delle entry `announced()` con `active: true/false` di MoQ). |
| `signal` (kind `offer`/`answer`/`ice`) | client ↔ server ↔ client | Negoziazione WebRTC, instradata dal server tra i due client interessati senza essere interpretata. |

## 11. Come funziona il signaling

`signaling/server.js` è un server WebSocket minimale (libreria [`ws`](https://www.npmjs.com/package/ws)) che mantiene in memoria una `Map<room, Map<username, connessione>>`. Non c'è persistenza, non c'è autenticazione (coerente con la versione MoQ, che usa `--auth-public`): serve solo a far incontrare i client della stessa room e a inoltrare i loro messaggi SDP/ICE.

Regola scelta per evitare offerte doppie simultanee ("glare"): **chi entra in una room per ultimo è sempre l'iniziatore** della connessione verso ciascun peer già presente (crea lui l'offerta SDP e il DataChannel). Chi era già in room non crea mai un'offerta di propria iniziativa: riceve la notifica `peer-joined`, prepara una `RTCPeerConnection` e aspetta passivamente l'offerta in arrivo. Questo rende impossibile una race condition tra due offerte senza bisogno di logica di "rollback" della negoziazione.

Un heartbeat WebSocket (ping/pong ogni 15s) rileva connessioni "zombie" (es. sospensione del laptop, rete caduta senza chiusura pulita) così la presenza nella room resta corretta anche in caso di disconnessioni brutali.

## 12. Differenze inevitabili rispetto alla versione MoQ

| Aspetto | Versione MoQ | Versione WebRTC | Perché è inevitabile |
|---|---|---|---|
| Affidabilità del canale "ultimo vince" | I gruppi QUIC sono **consegnati in modo affidabile**; è il subscriber a scartare deliberatamente i gruppi vecchi (`readGameTrack`), quindi in pratica nessun dato si perde davvero, si legge solo sempre l'ultimo disponibile. | Il DataChannel unordered/`maxRetransmits:0` **perde davvero** i pacchetti in caso di congestione/jitter di rete: qui non c'è nulla "dietro" che garantisca l'arrivo. | WebRTC (SCTP over DTLS over UDP) non offre un costrutto equivalente a "stream QUIC indipendenti sempre consegnati, ma il lettore prende solo l'ultimo": la scelta più fedele alla *semantica applicativa* voluta (stato più recente > stato vecchio) è un canale realmente inaffidabile. È una differenza attesa e interessante da misurare nel confronto (vedi `gapTotal`/`duplicateOrOutOfOrderTotal` nelle metriche esportate). |
| Architettura pub/sub vs mesh P2P | Relay centrale: publisher scrive su una track, N subscriber la leggono senza connessione diretta tra loro. | Mesh **peer-to-peer**: ogni coppia di client ha una propria `RTCPeerConnection`/DataChannel indipendente. Con 2 giocatori (caso d'uso del gioco) il traffico è identico; con più giocatori la banda in upload crescerebbe linearmente con N invece che restare costante come con un relay. | È una proprietà strutturale di WebRTC "puro" senza SFU: aggiungere un SFU (es. mediasoup) avrebbe reintrodotto un relay centrale, ma solo per media/dati real-time, non per il transport comparabile 1:1 richiesto qui. Per il confronto a 2 giocatori del progetto la differenza è comunque trascurabile. |
| Scoperta dei peer / presenza | Nativa nel protocollo MoQ (`connection.announced()`), nessun servizio aggiuntivo. | Richiede un server di signaling scritto ad hoc (`signaling/server.js`), perché WebRTC non specifica un meccanismo di rendez-vous. | Requisito intrinseco di WebRTC: qualunque implementazione ne ha bisogno. Si è scelto WebSocket, il più leggero possibile, usato solo per join/leave/SDP/ICE — mai per il traffico di gioco (vedi sezione 10). |
| Trasporto/cifratura | QUIC su WebTransport, TLS 1.3. | SCTP su DTLS su UDP, DTLS 1.2/1.3. | Stack di trasporto imposto dagli standard delle due tecnologie; entrambi cifrati end-to-end, non è una differenza di postura di sicurezza. |
| TLS pubblico / dominio | Il deployment originale usa certificati Let's Encrypt montati nel container e un dominio pubblico (`spaceinvasion.ddns.net`), necessario perché WebTransport richiede HTTPS con certificato valido. | Il dev server e il signaling girano in HTTP/WS in chiaro su `localhost` di default. | `RTCPeerConnection`/`RTCDataChannel` **non richiedono un contesto sicuro** per funzionare (a differenza di `getUserMedia`, non usato qui), quindi per il confronto locale non è necessario replicare l'infrastruttura TLS. `vite.config.ts` e `config.ts` sono comunque strutturati per aggiungere HTTPS/WSS a un deployment pubblico, se necessario (vedi commenti nei due file). |
| Import path del tipo `GameSnapshot` nei file di gioco copiati | `import type { GameSnapshot } from "../../moq/publisher"` | `import type { GameSnapshot } from "../../webrtc/snapshot"` | Unica modifica "di manutenzione" ai file di logica di gioco copiati verbatim da `LocalGameEngine.ts`/`localGame/types.ts`/`localGame/index.ts`: una singola riga di import per ciascun file, nessuna modifica di comportamento. |

## Metriche

`frontend/src/metrics/metrics.ts` è un porting 1:1 di `moq-keycast-ts/.../metrics.ts`: stesso meccanismo di echo per l'RTT (mai confrontare orologi di client diversi), stesso calcolo di jitter/gap/duplicati, stesso export CSV/JSON dal pulsante "ESPORTA METRICHE" (file rinominati `webrtc-metrics-*` invece di `moq-metrics-*` per non confonderli). Unica aggiunta, puramente additiva: `recordPeerConnected()` misura il tempo tra la creazione della `RTCPeerConnection` e l'apertura del DataChannel ("tempo di connessione"), loggato e incluso nel riepilogo/export — utile per il confronto ma assente nella versione MoQ perché lì non esiste un analogo "tempo di apertura canale" per coppia di client.

---

## MoQ → WebRTC mapping

| Flusso di comunicazione | Come funzionava con MoQ | Come è implementato con WebRTC | Canale/componente | Affidabilità | Ordinamento | Motivazione |
|---|---|---|---|---|---|---|
| Stato di gioco (`GameSnapshot`, 25 Hz) | Nuovo gruppo QUIC per snapshot su una track `"game"` per broadcaster; il subscriber legge sempre l'ultimo gruppo del buffer e scarta i precedenti (`track.state.groups`). | `RTCDataChannel("game")` per coppia di peer, un `channel.send()` per snapshot. | `webrtc/peerManager.ts` → `publishSnapshot()` / `channel.onmessage` | **Non affidabile** (`maxRetransmits: 0`) | **Non ordinato** (`ordered: false`) | Ogni snapshot è uno stato completo e autosufficiente: quello più recente rende obsoleto quello precedente, quindi ritrasmissione e ordinamento sono puro overhead di latenza. |
| Snapshot iniziale alla sottoscrizione | Primo gruppo scritto da `serveTrackRequests()` non appena arriva una richiesta di sottoscrizione. | Invio di `createEmptySnapshot()` in `channel.onopen`, non appena il DataChannel diventa `"open"`. | Stesso canale `"game"` | Stessa dei normali snapshot | Stessa dei normali snapshot | Dare subito al peer qualcosa da renderizzare prima del primo tick di rete (40ms dopo). |
| Scoperta/presenza dei peer nella room | `connection.announced(prefix)`, entry con `active: true/false`. | Messaggi `joined` / `peer-joined` / `peer-left` sul WebSocket di signaling. | `webrtc/connection.ts`, `signaling/server.js` | Affidabile (TCP/WebSocket) | Ordinato (TCP) | La presenza è un evento raro e piccolo: nessun bisogno di semantica "ultimo vince", anzi va garantita la consegna per non disallineare la UI. |
| Negoziazione della connessione peer-to-peer | Non esiste (la connessione è già stabilita: publisher e subscriber parlano entrambi con il relay). | Scambio di offerte/risposte SDP e candidati ICE via WebSocket (`kind: "offer"/"answer"/"ice"`). | `webrtc/connection.ts` → `webrtc/peerManager.ts` | Affidabile (TCP/WebSocket) | Ordinato (TCP) | Richiesto intrinsecamente da WebRTC; nessun impatto sulle metriche di gioco, avviene una sola volta per coppia di peer a inizio partita. |
| Identità/instradamento (path/room) | Path MoQ `moq-keycast/{room}/{username}`, con prefix-subscribe su `moq-keycast/{room}/`. | Coppia `(room, username)` nel messaggio `join`, univocità username verificata dal server per room. | `signaling/server.js` | — | — | Stesso concetto (namespacing per room + identità utente), realizzato con una `Map` invece che con path gerarchici, dato che WebRTC non ha un concetto nativo di "path". |
| Esportazione metriche (RTT/jitter/banda/perdite) | Pulsante "ESPORTA METRICHE" → JSON/CSV lato client, nessun traffico di rete aggiuntivo. | Identico: stesso pulsante, stesso formato, stesso meccanismo di echo. | `metrics/metrics.ts` | n/a (locale) | n/a (locale) | Nessuna differenza: la misura è puramente locale al client in entrambe le versioni. |

---

## Struttura del progetto

```
Space-invasion-WebRTC-provaF/
├── package.json              # script "dev" combinato (concurrently)
├── signaling/
│   ├── package.json
│   └── server.js              # server WebSocket di rendez-vous (join/leave/SDP/ICE)
└── frontend/
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    ├── package.json
    └── src/
        ├── main.ts             # wiring identico a moq-keycast-ts/.../main.ts
        ├── config.ts           # SIGNALING_URL, ICE_SERVERS, CHANNEL_GAME, NETWORK_TICK_HZ, ...
        ├── types.d.ts
        ├── webrtc/
        │   ├── connection.ts   # client del signaling (ex moq/connection.ts)
        │   ├── peerManager.ts  # mesh RTCPeerConnection + DataChannel (ex publisher+subscriber)
        │   ├── publisher.ts    # facciata (ex moq/publisher.ts)
        │   ├── subscriber.ts   # facciata (ex moq/subscriber.ts)
        │   └── snapshot.ts     # tipi GameSnapshot (ex definiti in moq/publisher.ts)
        ├── metrics/
        │   └── metrics.ts      # porting 1:1 + recordPeerConnected() additivo
        ├── ui/
        │   ├── lobby.ts        # invariata (branding "WEBRTC" al posto di "MOQ")
        │   └── game-room.ts    # invariata (solo import path di GameSnapshot)
        ├── game/localGame/     # COPIA VERBATIM da moq-keycast-ts (unico cambio: import path)
        │   ├── LocalGameEngine.ts
        │   ├── index.ts
        │   ├── types.ts
        │   ├── id.ts
        │   └── entities/
        │       ├── Player.ts, Invader.ts, Grid.ts, Projectile.ts,
        │       └── InvaderProjectile.ts, Particle.ts, Asteroid.ts
        └── image/
            ├── spaceship.png   # COPIA VERBATIM
            └── invader.png     # COPIA VERBATIM
```

## Limiti noti

- Nessun server TURN configurato: dietro NAT particolarmente restrittivi (NAT simmetrico su entrambi i lati) la connessione P2P potrebbe non stabilirsi. Non necessario per il confronto in rete locale/domestica; se serve, aggiungere un `{urls: "turn:...", username, credential}` a `ICE_SERVERS` in `config.ts`.
- La mesh P2P non scala oltre pochi giocatori per room (banda in upload lineare in N); per questo gioco (1v1) non è un problema, ma va tenuto presente se in futuro si aumentasse il numero di giocatori per room.
- Il server di signaling non ha persistenza né autenticazione: coerente con l'obiettivo (esperimento locale/didattico), da rafforzare se mai esposto pubblicamente.
