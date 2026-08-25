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
  punto 1). Le porte usate da questo stack (8080, 8081, 3478, 5349, 49152–49452) sono
  diverse da quelle del relay MoQ (443, 4443), quindi possono coesistere sulla stessa VM.
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

| Porta | Protocollo | Servizio | Note |
|---|---|---|---|
| 8081 | TCP | frontend (webapp) | modificabile in `deploy/.env` |
| 8080 | TCP | signaling (WebSocket) | modificabile in `deploy/.env` |
| 3478 | UDP+TCP | coturn (controllo TURN) | vedi sotto se solo 443 è aperta |
| 5349 | UDP+TCP | coturn (TURN su TLS, opzionale) | richiede certificato, vedi `turn/turnserver.conf` |
| 49152–49452 | **UDP** | coturn (dati relayati) | **indispensabile**, vedi nota sotto |

**Nota sul range 49152–49452**: è la parte che conta davvero. La porta di
"controllo" (3478 o 443) serve solo per la richiesta iniziale di allocazione TURN; i
pacchetti di gioco veri e propri, una volta allocato il relay, passano sulle porte di
questo range (una porta dinamica per sessione). Se il firewall blocca tutto questo range,
TURN non funziona anche se 3478/443 sono raggiungibili — non è un dettaglio rimandabile,
va verificato con chi amministra la VM.

**Se sulla VM è aperta solo la porta 443** (es. VM del Politecnico): in
`turn/turnserver.conf` imposta `listening-port=443` al posto di `3478` (già commentato
nel file). UDP/443 di coturn e TCP/443 di un eventuale altro servizio HTTPS sullo stesso
host non confliggono (protocolli diversi sulla stessa porta): coesistono senza problemi.
Il range 49152–49452 in UDP resta comunque necessario e **va aperto separatamente**: non
c'è modo di far passare anche i dati relayati dentro la sola 443 con una configurazione
standard di coturn. Se sulla rete del Politecnico non è possibile aprire quel range,
l'unica alternativa realistica è restringerlo (`min-port`/`max-port` in
`turnserver.conf`) a poche porte concordate con l'amministratore di rete, non eliminarlo.

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
export const SIGNALING_URL = "ws://<IP-o-dominio-della-VM>:8080";
...
const TURN_URL = "turn:<IP-o-dominio-della-VM>:3478"; // o :443 se hai usato il fallback
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
