import type { GameSnapshot } from "../../webrtc/snapshot";
import { LocalGameEngine } from "./LocalGameEngine";
import type { GameDifficultyConfig } from "./types";

//funzione principale che crea e avvia il gioco locale, accettando un canvas su cui disegnare, una funzione di callback per inviare
// snapshot al publisher
export function createLocalGame(
  canvas: HTMLCanvasElement,
  onSnapshot: (snapshot: GameSnapshot) => void,
  onScoreChange?: (score: number) => void,
  gameConfig?: GameDifficultyConfig,
): () => void {
  const game = new LocalGameEngine({
    canvas,
    onSnapshot,
    onScoreChange,
    gameConfig,
  });

  game.start();
  //funzione che permette di distruggere il gioco quando il giocatore si disconnette o chiude la finestra.
  return () => game.destroy();
}
