# syntax=docker/dockerfile:1.7
# Base image pinned by digest (node:22-alpine, multi-arch manifest list, resolved on 2026-10-03).
# Update the tag and digest together: docker buildx imagetools inspect node:22-alpine
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
ENV NODE_ENV=production
WORKDIR /app
# Run as the unprivileged "node" user that ships with the official image.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
# stdio is the default transport. Set MCP_TRANSPORT=http and MCP_AUTH_TOKEN to expose HTTP; the
# HTTP transport binds to 127.0.0.1 unless MCP_HOST says otherwise, so publish the port with
# docker run -p 127.0.0.1:3000:3000 -e MCP_HOST=0.0.0.0 only behind a reverse proxy you control.
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]
