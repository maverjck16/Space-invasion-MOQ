# Deploy del Testbed WebRTC + TURN (+ relay MoQ) — guida passo-passo

Questo documento copre il punto lasciato aperto in `turn/README.md`: "cosa devi fare tu
(richiede l'infrastruttura, non solo il codice)". Il codice è già pronto (vedi
`turn/README.md` per cosa è già stato cablato in `frontend/src/config.ts` e
`frontend/src/webrtc/peerManager.ts`); qui c'è **solo** l'infrastruttura mancante:
container per la webapp (frontend + signaling) e per coturn, pronti per girare su una VM
raggiungibile da entrambi i client di test.

**Nota importante**: non posso eseguire comandi su una VM remota o sulla VM del
Politecnico da questa sessione — posso solo leggere/scrivere file in questa cartella
`TIROCINIO` sul tuo PC. I comandi qui sotto vanno lanciati da te (via SSH) sulla macchina
che ospiterà il deployment.

## 0. Scegli la macchina

Serve una macchina con IP pubblico o raggiungibile da entrambi i client di test durante
gli esperimenti (stessa cosa richiesta dal relay MoQ). Due opzioni plausibili in base a
quanto già presente nel progetto:

- **La stessa macchina che già ospita il relay MoQ** (dominio `spaceinvasion.ddns.net`,
  certificati Let's Encrypt già presenti in `/etc/letsencrypt`, vedi
  `moq-keycast-ts/compose.yml` nel branch/progetto MoQ). Vantaggio: un solo host per
  entrambi i Testbed, niente nuovi certificati da gestire (qui non servono comunque, vedi
  punto 1).

  **Nota sulle porte (aggiornata 22/09/2026)**: questo stack riusa deliberatamente lo
  stesso schema a singola porta già verificato funzionante sulla VM Politecnico/OpenStack
  (80 frontend, 443 signaling+TURN, vedi `deploy/.env.example`), che coincide con le porte
  usate dal relay MoQ su questa VM (443, 4443). Funziona perché **MoQ e WebRTC vengono
  avviati/fermati uno alla volta, mai in contemporanea** (scelta dell'utente, che gestisce
  direttamente il firewall/VPC di questa VM): prima di un `docker compose up` qui, verifica
  che lo stack MoQ sia fermo (porta 443/4443 libera), e viceversa. Se in futuro servisse
  farli girare insieme, va ripristinato lo schema a porte dedicate (8080 signaling, 8081
  frontend, 3478 TURN - vedi la cronologia di questo file/di `deploy/.env.example` per i
  valori esatti) per evitare che i due `docker compose up` collidano sulla stessa porta.
- **La VM del Politecnico**, se invece è quella il target: verifica con il tutor quali
  porte sono davvero aperte in ingresso (vedi punto 3, "Se è aperta solo la 443").

## 1. Non serve HTTPS per la webapp WebRTC

A differenza della versione MoQ (che usa WebTransport e richiede per specifica un
contesto sicuro con certificato valido), `RTCPeerConnection`/`RTCDataChannel` funzionano
anche su HTTP semplice: qui non c'è `getUserMedia` che imporrebbe un contesto sicuro. Per
questo il deployment sotto è volutamente in HTTP/WS in chiaro (niente Let's Encrypt da
configurare per frontend/signaling). Se preferisci comunque servire tutto in HTTPS/WSS
(es. per coerenza visiva col deployment MoQ, o perché la rete del Politecnico blocca
porte non-443 non-TLS), va aggiunto un reverse proxy TLS davanti a `frontend`/`signaling`
riusando gli stessi certificati del relay MoQ — non incluso qui per non complicare un
deployment che non lo richiede funzionalmente; chiedi se ti serve e lo preparo.

## 2. Prepara le credenziali TURN

Sulla macchina di deployment, dentro la working copy del branch `webrtc-testbed`:

```bash
cd Space-invasion-MOQ   # o come si chiama la cartella clonata sulla VM
git checkout webrtc-testbed
```

Apri `turn/turnserver.conf` e cambia la riga:

```
user=spaceinvasion:CHANGE_ME_PASSWORD
```

con una password vera (es. `openssl rand -hex 16`). Tieni da parte username e password:
ti serviranno al punto 5 per `frontend/src/config.ts`.

## 3. Apri le porte sul firewall della VM

Schema attuale (22/09/2026), uguale a quello già usato sulla VM Politecnico/OpenStack:

| Porta | Protocollo | Servizio | Note |
|---|---|---|---|
| 80 | TCP | frontend (webapp) | modificabile in `deploy/.env` |
| 443 | TCP | signaling (WebSocket) | modificabile in `deploy/.env`; su questa VM coincide con la porta del frontend HTTPS di MoQ - va bene solo se i due stack non girano mai insieme, vedi punto 0 |
| 443 | **UDP** | coturn (controllo TURN) | `listening-port=443` + `no-tcp` in `turn/turnserver.conf`, cosi' da non confliggere con la TCP/443 del signaling sopra |
| 49152–49452 | **UDP** | coturn (dati relayati) | **indispensabile**, vedi nota sotto |

**Nota sul range 49152–49452**: è la parte che conta davvero. La porta di
"controllo" (443 qui) serve solo per la richiesta iniziale di allocazione TURN; i
pacchetti di gioco veri e propri, una volta allocato il relay, passano sulle porte di
questo range (una porta dinamica per sessione). Se il firewall blocca tutto questo range,
TURN non funziona anche se la porta di controllo è raggiungibile — non è un dettaglio
rimandabile, va verificato esplicitamente.

Se in futuro serve una porta dedicata invece di riusare la 443 (es. per far girare MoQ e
WebRTC in contemporanea), vedi `turn/turnserver.conf` per tornare al default coturn 3478
(commentando `no-tcp` e cambiando `listening-port`) e la cronologia di `deploy/.env.example`
per i valori 8080/8081 usati in quello schema.

## 4. Build e avvio

```bash
cd deploy/
cp .env.example .env
# modifica .env solo se le porte di default (8080/8081) sono già occupate sulla VM
docker compose up -d --build
docker compose ps      # verifica che i 3 servizi siano "Up"
docker compose logs -f coturn   # controlla che coturn sia partito senza errori
```

## 5. Punta il frontend al TURN e al signaling della VM

Sul tuo PC di sviluppo (non sulla VM), in `frontend/src/config.ts`:

```ts
export const SIGNALING_URL = "ws://<IP-o-dominio-della-VM>:443";
...
const TURN_URL = "turn:<IP-o-dominio-della-VM>:443?transport=udp";
const TURN_USERNAME = "spaceinvasion";
const TURN_CREDENTIAL = "<la password messa al punto 2>";
```

Questi valori sono compilati dentro il bundle statico al momento della build (`vite
build`, dentro il Dockerfile di `frontend/`): dopo averli modificati, ricostruisci e
rideploya **sulla VM** (non basta modificare `.env`, vanno modificati i sorgenti e
ricommittati/ripubblicati):

```bash
# sulla VM, dopo aver aggiornato frontend/src/config.ts (git pull o copia manuale)
cd deploy/
docker compose up -d --build frontend
```

## 6. Avvia anche il relay MoQ (per il confronto)

Il relay MoQ **esiste già** ed è un progetto/branch separato da questo (vedi
`moq-keycast-ts/compose.yml`, immagine `moq-keycast-relay`, certificati Let's Encrypt per
`spaceinvasion.ddns.net`). Non l'ho toccato: se non è già in esecuzione sulla stessa VM,
si avvia con i suoi comandi esistenti:

```bash
cd moq-keycast-ts/   # progetto MoQ, non questo
docker compose up -d
```

Con relay MoQ + coturn + webapp WebRTC attivi sulla stessa macchina, entrambi i Testbed
percorrono una topologia a due hop (client → relay/TURN remoto → client): è la
condizione descritta in `turn/README.md` per rendere il confronto tra le due tecnologie
equo, invece di misurare "un percorso remoto contro uno locale".

## 7. Verifica che TURN sia davvero usato

Prima di rilanciare gli esperimenti, verifica dai `chrome://webrtc-internals` (o dai log
di `peerManager.ts` in console) che i candidati ICE selezionati siano di tipo `relay` e
non `host`/`srflx`. Se `FORCE_TURN_RELAY` è `true` (default, vedi `config.ts`) e il TURN
non è raggiungibile, la connessione WebRTC fallirà del tutto invece di silenziosamente
tornare diretta — è il comportamento voluto (altrimenti non ti accorgeresti se il TURN
non sta effettivamente relayando).

## 8. Rilancia esperimenti e grafici

Solo a questo punto ha senso rieseguire gli scenari su entrambi i Testbed (stessi seed,
stessi run) e rigenerare i grafici di confronto, come indicato in `turn/README.md`.

---

## Cosa NON è (ancora) incluso qui

- HTTPS/WSS per frontend e signaling (vedi punto 1: non necessario funzionalmente).
- Generazione automatica delle credenziali TURN dal file `.env` (coturn le legge da
  `turn/turnserver.conf`, non da variabili d'ambiente; vedi punto 2).
- Scelta della macchina di deployment e apertura effettiva delle porte sul firewall:
  richiede accesso che questa sessione non ha (vedi nota in cima al file).
