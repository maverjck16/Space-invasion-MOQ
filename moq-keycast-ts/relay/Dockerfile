FROM rust:1.89-bookworm AS builder
RUN cargo install moq-relay --locked

FROM debian:bookworm-slim
COPY --from=builder /usr/local/cargo/bin/moq-relay /usr/local/bin/moq-relay

EXPOSE 4443/tcp
EXPOSE 4443/udp
