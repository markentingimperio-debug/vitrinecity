FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app
COPY package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs /app/server.mjs

ENV NODE_ENV=production
EXPOSE 8792
CMD ["node", "/app/server.mjs"]
