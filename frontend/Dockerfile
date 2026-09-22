# Build multi-stage del frontend (Vite/TS) del Testbed WebRTC, servito poi da nginx.
#
# IMPORTANTE: SIGNALING_URL / TURN_URL / TURN_USERNAME / TURN_CREDENTIAL in
# frontend/src/config.ts sono costanti compilate DENTRO il bundle statico (`vite build`).
# Vanno editate con i valori reali della VM di deployment PRIMA di lanciare questa build
# (vedi ../deploy/DEPLOY.md) — non sono leggibili/modificabili a runtime dal container.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# COPY preserva i permessi dei file sorgente: se in frontend/public/ (es. public/scenarios/*.json)
# alcuni file hanno permessi restrittivi (es. 600, come visto il 22/09/2026 - illeggibili per
# l'utente non privilegiato con cui gira il worker nginx, causa 403 su /scenarios/*.json), vanno
# resi leggibili esplicitamente qui, a prescindere da come sono messi sul filesystem sorgente.
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
