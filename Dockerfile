# syntax=docker/dockerfile:1
# One pinned environment for building and testing Founder Village: Rust, Solana CLI, Anchor, Node and
# the mainnet SAS and Squads binaries the tests run against. linux/amd64 because Surfpool's
# embedded binary ships for Linux x86-64 only. Every download is checked against a SHA-256.

FROM --platform=linux/amd64 ubuntu:24.04 AS toolchain

ARG RUSTUP_VERSION=1.29.1
ARG RUSTUP_SHA256=dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71
ARG RUST_VERSION=1.99.1
ARG SOLANA_VERSION=4.1.2
ARG SOLANA_SHA256=5991d027a686eb419a709a479178b33eb83501e8a2bfbf599a81a286bfcbf770
ARG ANCHOR_VERSION=1.2.1
ARG ANCHOR_SHA256=5c899379cbd9a843fa4a730a37ba7ab61357571ffc535036a9afa08e5cd0b99b
ARG NODE_VERSION=22.12.0
ARG NODE_SHA256=22982235e1b71fa8850f82edd09cdae7e3f32df1764a9ec298c72d25ef2c164f

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/opt/solana/bin:/opt/node/bin:$PATH \
    NO_DNA=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl bzip2 xz-utils git \
      build-essential pkg-config libssl-dev libudev-dev \
 && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl -sSfL --retry 5 --retry-all-errors -o /tmp/rustup-init "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
 && echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum -c - \
 && chmod +x /tmp/rustup-init \
 && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" --component rustfmt,clippy \
 && rm /tmp/rustup-init

# Solana CLI (Agave release tarball: solana, cargo-build-sbf, solana-keygen, ...)
RUN curl -sSfL --retry 5 --retry-all-errors -o /tmp/solana.tar.bz2 "https://github.com/anza-xyz/agave/releases/download/v${SOLANA_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2" \
 && echo "${SOLANA_SHA256}  /tmp/solana.tar.bz2" | sha256sum -c - \
 && mkdir -p /opt && tar -xjf /tmp/solana.tar.bz2 -C /opt \
 && mv /opt/solana-release /opt/solana && rm /tmp/solana.tar.bz2

# Anchor CLI (prebuilt release binary)
RUN curl -sSfL --retry 5 --retry-all-errors -o /usr/local/bin/anchor "https://github.com/otter-sec/anchor/releases/download/v${ANCHOR_VERSION}/anchor-${ANCHOR_VERSION}-x86_64-unknown-linux-gnu" \
 && echo "${ANCHOR_SHA256}  /usr/local/bin/anchor" | sha256sum -c - \
 && chmod +x /usr/local/bin/anchor

# Node
RUN curl -sSfL --retry 5 --retry-all-errors -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 \
 && rm /tmp/node.tar.xz

RUN rustc --version && solana --version && anchor --version && node --version

WORKDIR /founder-village

# Program first: this layer downloads the SBF platform-tools and compiles the dependencies once.
FROM toolchain AS program
COPY Cargo.toml Cargo.lock Anchor.toml ./
COPY programs ./programs
# --ignore-keys: the program keypair is never copied into the image; declare_id! fixes the ID.
RUN anchor build --ignore-keys

# Node dependencies, then the rest of the repository.
FROM program AS workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN anchor build --ignore-keys && npm run fixtures:programs

EXPOSE 5183
CMD ["bash", "scripts/gate.sh"]
