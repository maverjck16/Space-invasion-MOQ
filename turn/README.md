# TURN per il Testbed WebRTC (confronto equo con MoQ)

## Perché serve

Michele ha notato che, dai primi grafici, WebRTC risulta nettamente migliore di MoQ — ma è un confronto sbilanciato: MoQ passa **sempre** dal relay remoto (client → relay → client, due salti di rete), mentre WebRTC, quando i due client girano sulla stessa macchina o rete locale (come nell'uso tipico del Testbed), sceglie quasi certamente un percorso diretto (un solo salto). Non si sta misurando "MoQ vs WebRTC", ma "un percorso remoto vs uno locale".

Un server **TURN** (qui coturn, la stessa libreria linkata da Michele: <https://github.com/coturn/coturn>) è un relay per WebRTC: se lo configuri e forzi il client a usarlo, anche WebRTC deve passare da un server remoto invece che andare diretto. Con questo attivo, entrambe le tecnologie percorrono una topologia a due salti, e il confronto misura davvero la differenza tra i due trasporti.

## Cosa ho già fatto nel codice (branch `webrtc-testbed`)

- `frontend/src/config.ts`: aggiunti `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` (vuoti di default = nessun cambiamento rispetto a prima) e un flag `FORCE_TURN_RELAY` che, quando è impostato un TURN, forza `iceTransportPolicy: "relay"`.
- `frontend/src/webrtc/peerManager.ts`: la `RTCPeerConnection` ora usa quel `iceTransportPolicy`.

Finché non compili `TURN_URL`, il comportamento è identico a prima (solo STUN pubblico, nessun TURN).

## Cosa devi fare tu (richiede l'infrastruttura, non solo il codice)

1. Avviare il server TURN da qualche parte raggiungibile da entrambi i client di test:
   ```
   cd turn/
   docker compose up -d
   ```
   Il file `turnserver.conf` ha una password segnaposto (`CHANGE_ME_PASSWORD`): cambiala prima di esporre il server.

2. Aprire sul firewall della macchina che ospita coturn le porte usate in `turnserver.conf` (di default 3478 TCP/UDP, 5349 TCP/UDP per TLS, e il range 49152–49452 UDP per il traffico relayato). Se su quella macchina è aperta solo la 443 (mi risulta lo sia sulla VM del Politecnico), puoi impostare `listening-port=443` in `turnserver.conf` — è una pratica comune per i server TURN pubblici dietro NAT/firewall restrittivi.

3. In `frontend/src/config.ts`, compilare:
   ```ts
   const TURN_URL = "turn:<IP-o-dominio-del-server-coturn>:3478";
   const TURN_USERNAME = "spaceinvasion";
   const TURN_CREDENTIAL = "<la password messa in turnserver.conf>";
   ```
   Da quel momento il Testbed WebRTC forza il traffico attraverso il TURN.

4. Rieseguire gli esperimenti (stessi scenari, stessi run) su entrambi i Testbed e rigenerare i grafici: a questo punto il confronto MoQ vs WebRTC nella relazione sarà su basi di rete comparabili.

## Cosa NON ho toccato

Non ho deciso su quale macchina far girare coturn né toccato il deployment (l'hai detto tu: quello lo segui tu). Questo README presume che tu scelga dove e come farlo girare; il codice è già pronto ad usarlo appena gli dai un URL.
