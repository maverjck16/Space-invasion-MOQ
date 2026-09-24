# Immagine per il server autoritativo dell'arena condivisa (vedi simulation.js/server.js).
# Trasporta punteggio/vite/stato di invasori-asteroidi-proiettili nemici: e' l'UNICA copia
# esistente di questo stato, a differenza di prima (nessun dato di gioco condiviso passava qui,
# perche' non esisteva alcun server: ogni client lo ricalcolava in locale con un seed comune).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY simulation.js server.js stats.js ./

# Configurabile a runtime con ARENA_PORT (default 8081, vedi server.js). Porta diversa da quella
# del signaling (SIGNALING_PORT, di norma 443/8080) cosi' i due servizi possono girare sulla
# stessa VM senza conflitti.
ENV ARENA_PORT=8081
EXPOSE 8081

CMD ["node", "server.js"]
