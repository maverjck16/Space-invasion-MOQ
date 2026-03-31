import { renderLobby } from "./ui/lobby";
import {
  renderGameRoom,
  updatePresence,
  updateRemoteGame,
} from "./ui/game-room";

import { connectToRelay, disconnectFromRelay } from "./moq/connection";
import {
  startPublisher,
  stopPublisher,
  publishSnapshot,
  type GameSnapshot,
} from "./moq/publisher";
import { startSubscriber, stopSubscriber } from "./moq/subscriber";

//allo start dell'applicazione mostro la lobby, da cui l'utente può inserire username e room a cui connettersi.
//  Una volta connesso, mostro la schermata di gioco, e avvio publisher e subscriber. Se l'utente lascia la room, 
// o se c'è un errore di connessione, torno alla lobby.
function start() {
  renderLobby(async (username, room) => {
    try {
      await connectToRelay();
      await startPublisher(room, username);

      renderGameRoom(username, room, {
        onSnapshot: (snapshot: GameSnapshot) => {
          publishSnapshot(snapshot);
        },

        onLeave: () => {
          stopSubscriber();
          stopPublisher();
          disconnectFromRelay();
          start();
        },
      });

      await startSubscriber(
        room,
        username,
        (remoteUsername, snapshot) => {
          updateRemoteGame(remoteUsername, snapshot);
        },
        (users) => {
          updatePresence(users);
        },
      );
    } catch (err) {
      console.error(err);
      stopSubscriber();
      stopPublisher();
      disconnectFromRelay();
      start();
    }
  });
}

start();