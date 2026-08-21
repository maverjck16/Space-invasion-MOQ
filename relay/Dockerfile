# Dockerfile.relay
FROM rust:slim-bullseye AS builder

# Install the official moq-relay crate directly from the developers.
# By default, this compiles WITHOUT the broken jemalloc feature!
# --features qlog aggiunge (senza rimuovere i default: iroh, quinn, websocket, uds) il supporto
# per --server-quic-qlog, usato per esportare le tracce QUIC in formato qlog a scopo di misura.
RUN cargo install moq-relay --version 0.14.12 --features qlog --locked

FROM debian:bullseye-slim
# Install required certificates for WebTransport
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the working binary from the builder
COPY --from=builder /usr/local/cargo/bin/moq-relay /usr/local/bin/moq-relay

ENTRYPOINT ["moq-relay"]