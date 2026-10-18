FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY web ./web
COPY server ./server
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 DB_PATH=/data/parcelmate.sqlite
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/bin ./server/bin
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/src/index.js"]
