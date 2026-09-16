FROM node:22-alpine
WORKDIR /service
RUN apk add --no-cache git
COPY ops/lia-agent/package.json ./package.json
COPY ops/lia-agent/server.js ./server.js
RUN mkdir -p /data /workspace
ENV NODE_ENV=production PORT=8090 WORKSPACE=/workspace
EXPOSE 8090
CMD ["node","server.js"]
