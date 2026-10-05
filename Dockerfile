# BookmarkForge production images
# Pinned by digest (audit 2026-08-30): tag mutable → digest inmutable para
# reproducibilidad y mitigación de supply-chain. Actualizar manualmente tras
# verificar el changelog de la imagen y re-obtener el digest.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
# Quitamos SOLO `prepare: husky`: su prepare falla (exit 127) en la imagen y
# husky solo gestiona hooks de git locales. Eliminarlo en el contenedor
# conserva el resto de scripts; se quita SOLO prepare, nunca con
# --ignore-scripts (rompería el postinstall de esbuild/vite en el stage build).
RUN npm pkg delete scripts.prepare && npm ci --omit=dev && npm cache clean --force

FROM base AS build
COPY package.json package-lock.json ./
# NODE_ENV=development es OBLIGATORIO aquí: npm usa NODE_ENV=production del base
# para omitir las devDependencies y vite/esbuild son devDeps, así que sin esto
# nodes_modules/vite no existiría y build:ci fallaria. Se quita solo el
# scripts.prepare (husky) para que no rompa el npm ci; el postinstall de esbuild
# debe correr (por eso NO usamos --ignore-scripts en este stage).
RUN npm pkg delete scripts.prepare && NODE_ENV=development npm ci

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
# nginx corre como usuario no-root: el `pid /run/nginx.pid;` del main conf de
# la imagen base apunta a /run (root-owned) y el arranque fallaría con
# "open() /run/nginx.pid ... Permission denied". Se redirige el pid a /tmp
# (escribible por el usuario no-root) sustituyendo la directiva en el main conf
# (editar /etc/nginx/conf.d/* no funciona: `pid` es directiva de contexto main),
# ANTES de cambiar a USER no-root para poder escribir el fichero.
RUN addgroup -S bookmarkforge && adduser -S -G bookmarkforge bookmarkforge \
  && sed -i 's|/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
  && chown -R bookmarkforge:bookmarkforge /usr/share/nginx/html \
  && mkdir -p /var/cache/nginx /var/run /var/log/nginx \
  && chown -R bookmarkforge:bookmarkforge /var/cache/nginx /var/run /var/log/nginx
USER bookmarkforge

FROM base AS api
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
USER node
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
