// Facciata sottile su peerManager.ts con la stessa interfaccia di moq/subscriber.ts nella
// versione MoQ, per mantenere main.ts il piu' possibile speculare tra le due implementazioni.
export { startSubscriber, stopSubscriber } from "./peerManager";
