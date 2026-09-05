FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app
RUN apk add --no-cache python3 make g++ ffmpeg
COPY package*.json ./
RUN npm ci --omit=dev
COPY *.js ./
COPY affiliate-catalog-seed.json ./
COPY public ./public
RUN node prepare-public-highlights.js
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server.js"]
