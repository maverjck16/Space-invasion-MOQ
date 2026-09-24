// Facciata sottile su peerManager.ts con la stessa interfaccia di moq/publisher.ts nella versione
// MoQ, per mantenere main.ts il piu' possibile speculare tra le due implementazioni.
export type { GameSnapshot } from "./snapshot";
export { startPublisher, stopPublisher, publishSnapshot } from "./peerManager";
