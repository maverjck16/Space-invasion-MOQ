ESERCIZIO CHAT MOQ
==>	Si avvia con Docker,  “Docker compose up”
3 blocchi logici principali: 
-	UI (interfaccia utente con schermata lobby e chat)
-	Moq (collegamento al relay)
-	Publisher e subscriber con invio e ricezione dati

Parte tutto da index.html, non contiene logica vera e propria ma crea un div e carica il main

---------main.ts
Regista dell'app, funzione principale start() che quando patrte mostra la lobby grazie a
renderLobby() ==> crea con HTML la grafica della lobby con campo username e room + tasto button join.
onJoin() ==> funzione anonima passata come parametro di renderLobby. Il comportamento è definito in main.ts (await dice di aspettare finchè operazione non ha finito): 
    - connectToRelay() ==> aspetta che la connessione venga aperta in config.ts per passare  alla riga successiva. (VEDI connection.ts) 
    - startPublisher() ==> recupera la connessione, costruisce il path dell'utente (con uusername e room), crea un broadcast, pubblica il broadcast sul relay e si meyte in attesa delle richieste di track. Il broadcast è un contenitore di dati che voglio rendere disponibile agli altri. 
        - serveTrackRequests() ==> attende una richiesta di track. Ciclo infinito che rimane in attesa di richieste con await broadcast.requested(), estrae la track richiesta con 
        const { track } = request, ne controlla il tipo (es. TYPING definito in config.ts), salva la track tra  quelle attive con activeTypingTracks.add(track), dove activeTypingTracks è un SET
        utilizzato da activeTypingTracks per inviare payload. 
        - publishTyping() riceve il testo inserito dall'utente nella textArea e crea e invia il payload.
    - renderChatRoom() ==> crea l'interfaccia della chat-room, ogni volgta che viene cliccato un tasto per scrivere viene chiamata la funzione onTyping che a sua volta chiama publishTyping(testo inserito).
    - startSubscriber() ==> aspetta che il subscriber si metta in ascolto. 
    Publisher manda i dati, Subscriber li riceve dagli altri utenti e aggiorna la schermata.
    Per farlo si connette al relay, ascolta gli annunci ignorando quelli locali, si iscrive alla track degli utenti remoti, legge i payload ricevuti e aggiorna l'interfaccia.
    Alla connessione di un utente, viene pubblicato un broadcast con un certo path usato dal subscriber per vedere chi sta pubblicando in quella determinata stanza.
         - AbortController usato per fermare operazioni asincrone del subscriber (se esco dalla stanza blocco tutto)
         - peers è l'array degli utenti remoti
         - startSubscriber() avvia tutto: prende la connessione, crea l'AbortController, e parte da uno stato pulito svuotando la lista dei peers. 
         Chiede al realy di avvisarlo quando compare o scompare un publisher con connection.announced()
         e avvia l'ascolto degli annunci con watchAnnouncements().
         Questa funzione reagisce quando un peer entra o esce, crea una mappa di controller per ogni utente (ogni utente associato ad un AbortController), quando un peer entra e va tutto bene mi collego al suo broadcast con const remoteBroadcast = connection.consume(entry.path),
         ricevo il track con const typingTrack = remoteBroadcast.subscribe(TRACK_TYPING, TRACK_PRIORITY) e avvio la lettura con void readTypingTrack(typingTrack, remoteUsername, ctrl.signal, onPeerUpdate).
         - readTypingTrack()legge i dati inviati dal publisher: prende il payload e il peer, lo aggiorna con const peer = ensurePeer(username);
                      peer.text = payload.text;
                      peer.timestamp = payload.timestamp;
                      onPeerUpdate([...peers]);

--------connection.ts
Importo moq/lite nell'oggetto Moq per poter usare Connection.connect(), Broadcast e Path.from().
Creo una connessione dato un url da cui poi faccio publish(), subscribe() e consume() e la salvo in una variabile globale per poterla riutilizzare senza crearne di multiple.







