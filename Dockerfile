# BookmarkForge production images
# Pinned by digest (audit 2026-08-30): tag mutable → digest inmutable para
# reproducibilidad y mitigación de supply-chain. Actualizar manualmente tras
# verificar el changelog de la imagen y re-obtener el digest.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_APP_VERSION
ARG VITE_DB_NAME
ARG VITE_P2P_SIGNALING_URL
ARG VITE_WHOP_CHECKOUT_URL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_DB_NAME=$VITE_DB_NAME
ENV VITE_P2P_SIGNALING_URL=$VITE_P2P_SIGNALING_URL
ENV VITE_WHOP_CHECKOUT_URL=$VITE_WHOP_CHECKOUT_URL
RUN npm run build:ci

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY public/nginx.conf /etc/nginx/conf.d/default.conf
RUN addgroup -S bookmarkforge && adduser -S -G bookmarkforge bookmarkforge \
  && chown -R bookmarkforge:bookmarkforge /usr/share/nginx/html \
  && mkdir -p /var/cache/nginx /var/run /var/log/nginx \
  && chown -R bookmarkforge:bookmarkforge /var/cache/nginx /var/run /var/log/nginx
USER bookmarkforge
# The base nginx entrypoint still needs to bind its configured ports; the
# container is intended to run behind the deployment's process isolation.

FROM base AS api
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
USER node
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
