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