# Immagine per il server di signaling WebSocket (rendez-vous del Testbed WebRTC).
# Non trasporta mai il traffico di gioco: solo join/leave/SDP/ICE (vedi server.js).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

# Configurabile a runtime con SIGNALING_PORT (default 8080, vedi server.js).
ENV SIGNALING_PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
