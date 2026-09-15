# Testing only. This image and the npm package must use the same Playwright release.
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /opt/browser-tests
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
ENV PLAYWRIGHT_MODULE=/opt/browser-tests/node_modules/playwright/index.mjs
