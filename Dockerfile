FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_FILE=/app/data/board.json
WORKDIR /app
RUN addgroup -S kanban && adduser -S kanban -G kanban && mkdir -p /app/data && chown -R kanban:kanban /app
COPY --from=deps --chown=kanban:kanban /app/node_modules ./node_modules
COPY --chown=kanban:kanban package.json openapi.json ./
COPY --chown=kanban:kanban src ./src
COPY --chown=kanban:kanban public ./public
USER kanban
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/server.js"]
