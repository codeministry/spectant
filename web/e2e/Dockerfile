# The pinned Linux runner for every Playwright suite (T28, plan 001 § Risks "baselines drift between machines").
# Visual baselines are recorded and compared only in here, locally and in CI, so fonts, antialiasing and the Chromium
# build are the same everywhere. Built and run by `web/e2e/container.ts` (`bun run test:visual:ci`).
#
# The Playwright tag MUST equal the `@playwright/test` version in web/package.json; container.ts refuses to run
# otherwise. Both images are pinned by tag and digest; bumping Playwright means bumping the tag, the digest and the
# devDependency together.

FROM oven/bun:1.3.12@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160 AS bun

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27

# The image carries Node (for the Angular CLI and the Playwright runner) and the browsers under /ms-playwright;
# bun is the repository's package manager and script runner, at the version root package.json pins.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Read by playwright.config.ts: snapshots may be written only where this is set.
ENV SPECTANT_E2E_CONTAINER=1

WORKDIR /work
