# GUI sulle due VM-player (guida operativa)

> **Cosa ho potuto verificare da qui**: solo i file del progetto nella cartella `TIROCINIO`
> collegata a questa sessione (`Space-invasion-MOQ/README.md`, `TESTBED.md`,
> `deploy/DEPLOY.md`, `deploy/compose.yml`, `deploy/.env.example`). **Non ho accesso a
> terminale né sulla VM "principale" né sulle due VM-player** — questa sessione può solo
> leggere/scrivere file in questa cartella sul tuo PC, non eseguire comandi su macchine
> remote. Quindi questa è una guida che devi eseguire tu (via SSH), non qualcosa che ho
> già fatto. Dove ho dovuto assumere qualcosa che il codice non conferma (distro delle VM,
> se il deploy Docker sia già `up`, quale branch userete oggi) l'ho segnalato esplicitamente.

## 0. Cosa fa da server e cosa deve solo "vedere" il gioco

Dai file del progetto:

- **VM principale** (quella che usi già via VS Code/SSH): ospita i componenti headless —
  nessuna GUI necessaria lì. A seconda del branch:
  - **WebRTC**: `signaling` (WS, porta 8080) + `frontend` (porta 8081 via Docker, o 5173
    in dev) + `coturn` (TURN, 3478 + range UDP 49152–49452), vedi `deploy/compose.yml` e
    `deploy/DEPLOY.md`.
  - **MoQ**: relay `moq-keycast-ts` (porte 443/4443, dominio `spaceinvasion.ddns.net`,
    certificati Let's Encrypt) — progetto/branch separato, non ho ispezionato i suoi file
    in dettaglio in questa sessione.
- **Le due VM-player**: devono solo aprire un **browser** sull'URL del frontend e
  permetterti di giocare manualmente (WASD + SPAZIO) guardando lo schermo — è lì che manca
  la GUI.

## 1. Decisione: come dare la GUI alle due VM-player

Ho scartato **X11 forwarding puro** (`ssh -X`/`-Y` sul solo processo del browser): il gioco
è un canvas 2D che si ridisegna di continuo (60fps di rendering, 25Hz di rete) e il
protocollo X11 su una connessione non locale rende questo genere di contenuto animato
molto meno fluido (lag percepito, input scattoso) rispetto a un vero desktop remoto — un
rischio concreto per un test dove serve schivare/sparare con precisione.

**Scelta**: desktop leggero **XFCE** + server **VNC (TigerVNC)**, raggiunto tramite
**tunnel SSH** (quindi uso comunque l'SSH che già usi per collegarti, ma solo come
trasporto cifrato per il VNC, non per il forwarding diretto delle finestre). Motivi:

- XFCE è il desktop completo più leggero e maturo per Debian/Ubuntu (~250–400MB di RAM a
  riposo, nessuna dipendenza pesante), a differenza di GNOME/KDE.
- VNC trasmette i pixel già renderizzati (con compressione), quindi regge molto meglio di
  X11 forwarding un canvas animato.
- Il tunnel SSH evita di esporre la porta VNC (di per sé non cifrata) direttamente in
  rete: usi solo la porta SSH che probabilmente è già l'unica aperta in ingresso.

Se preferisci comunque X11 forwarding o RDP (xrdp) per qualche motivo (es. politiche di
rete del Politecnico), la procedura è simile: sostituisci il passo 3 con `sudo apt install
xrdp` e connettiti con un client RDP invece che VNC. Dimmelo se vuoi che riscriva questa
sezione per RDP.

## 2. Rete: le VM-player devono raggiungere la VM principale

Verifica (con il tutor, se non lo sai già) che dalle due VM-player siano raggiungibili in
ingresso/uscita le porte del branch che userete:

- WebRTC: `<IP-vm-principale>:8081` (webapp), `:8080` (signaling WS), `:3478` +
  UDP 49152–49452 (TURN) — vedi tabella in `deploy/DEPLOY.md` punto 3.
- MoQ: `spaceinvasion.ddns.net:443` (o come configurato nel relay).

Se le tre VM sono sulla stessa rete del Politecnico questo di solito è già vero; se una
delle due player è dietro un firewall più restrittivo, il traffico di gioco WebRTC passa
comunque dal TURN (se `FORCE_TURN_RELAY=true`, come da `config.ts`), quindi basta che la
player raggiunga la VM principale, non serve NAT traversal tra le due player.

## 3. Su OGNI VM-player: installa un desktop minimale + VNC

Comandi per Debian/Ubuntu (la distro più probabile per una VM del Politecnico; se è
un'altra distro dimmelo e adatto i comandi a dnf/yum/zypper). Via SSH sulla VM-player:

```bash
sudo apt update
sudo apt install -y xfce4 xfce4-session lightdm tigervnc-standalone-server \
    tigervnc-common chromium
```

Nota: ho omesso `xfce4-goodies` (plugin/applet extra, non necessari solo per aprire un
browser) per restare il più leggeri possibile, come richiesto. Se preferisci una barra
completa aggiungilo pure, il sovraccarico è comunque piccolo.

Se il pacchetto si chiama `chromium-browser` invece di `chromium` (dipende dalla release
Ubuntu), usa quello.

## 4. Configura VNC per avviare XFCE (non il desktop di default)

```bash
vncserver :1   # la prima volta ti chiede una password (max 8 char per protocollo VNC classico)
vncserver -kill :1
```

Modifica `~/.vnc/xstartup` così (sostituisci il contenuto):

```bash
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec startxfce4
```

```bash
chmod +x ~/.vnc/xstartup
vncserver :1 -geometry 1280x800 -depth 24
```

`1280x800` è già una risoluzione leggera e sufficiente per il gioco (canvas piccolo);
riducila ulteriormente (es. `1024x768`) se la VM è molto limitata in RAM/CPU.

## 5. Collegati da un tuo terminale (host) via tunnel SSH

Su ogni player fai partire `vncserver :1` una volta (display `:1` = porta 5901). Dal tuo
PC, per ciascuna VM-player (usa una porta locale diversa per la seconda, es. 5902):

```bash
ssh -L 5901:localhost:5901 <utente>@<ip-vm-player-1>
# in un altro terminale:
ssh -L 5902:localhost:5901 <utente>@<ip-vm-player-2>
```

Lascia questi due terminali aperti (il tunnel vive finché la sessione SSH è aperta), poi
apri un client VNC (Remmina — di solito preinstallato su Ubuntu desktop — o TigerVNC
Viewer, o Vinagre) verso:

- `localhost:5901` → VM-player 1
- `localhost:5902` → VM-player 2

Così hai due finestre desktop indipendenti sullo stesso tuo schermo, una per giocatore.

## 6. Avvia il gioco

Su ciascuna VM-player, dentro la sessione desktop XFCE appena aperta: apri Chromium e vai
su:

- **WebRTC**: `http://<ip-o-dominio-vm-principale>:8081`
- **MoQ**: `https://spaceinvasion.ddns.net` (o l'URL effettivo del relay)

Inserisci nome pilota diverso per le due VM e la **stessa room** su entrambe, poi GIOCA
(vedi `README.md` sezione 5). Dopo pochi istanti lo stato passa a "Connesso con...".
Comandi in gioco: WASD per muoversi, SPAZIO per sparare. Il pulsante **ESPORTA METRICHE**
scarica RTT/jitter/perdite/byte della sessione a fine partita.

## 7. Prima di lanciare esperimenti: verifica sulla VM principale

Se non sei certo che il deploy lato server sia già attivo (non ho potuto verificarlo da
qui):

```bash
# sulla VM principale, dentro la working copy del branch webrtc
cd deploy/
docker compose ps        # i 3 servizi (coturn, signaling, frontend) devono essere "Up"
docker compose logs -f coturn   # nessun errore evidente
```

Se non è ancora `up`: `docker compose up -d --build` (vedi `deploy/DEPLOY.md` punto 4).
Per il branch MoQ, il relay si avvia a parte con `docker compose up -d` dentro
`moq-keycast-ts/` (non ho ispezionato questo progetto in dettaglio in questa sessione).

## 8. Dimensionamento risorse consigliato per le due VM-player

Con solo XFCE (senza goodies) + un tab Chromium, bastano indicativamente **2 vCPU e
2–4 GB di RAM** a testa. Se noti scatti nel desktop via VNC, disattiva il compositor di
XFCE (Impostazioni → Gestore finestre → scheda "Compositor" → disattiva) — spesso è lui la
causa di lag percepito in sessioni VNC/desktop virtualizzati, non la CPU.

## 9. Checklist riassuntiva

- [ ] Porte/rete verificate tra le tre VM (punto 2)
- [ ] `xfce4` + `tigervnc` + `chromium` installati su entrambe le player (punto 3)
- [ ] `xstartup` configurato, `vncserver :1` avviato su entrambe (punti 4–5)
- [ ] Tunnel SSH aperti dal tuo PC verso entrambe (punto 5)
- [ ] Client VNC connesso a `localhost:5901` e `:5902`
- [ ] Deploy lato server verificato `Up` (punto 7)
- [ ] Browser aperto su entrambe le player, stessa room, nomi pilota diversi
