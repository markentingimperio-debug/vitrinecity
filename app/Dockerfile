FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ ffmpeg
COPY package*.json ./
RUN npm install --omit=dev
COPY *.js ./
COPY affiliate-catalog-seed.json ./
COPY public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server.js"]
