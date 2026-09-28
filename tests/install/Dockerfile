# A clean Linux machine for `bun run test:install:linux` (T14, ISC-10): Ubuntu with curl and nothing else. No bun, no
# node: the installer must work before either exists. The test runs as a non-root user, so `/usr/local/bin` stays
# root-owned and the installer's fallback to `~/.local/bin` is what gets exercised.
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash tester

USER tester
WORKDIR /home/tester
