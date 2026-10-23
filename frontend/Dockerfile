# syntax=docker/dockerfile:1
# Roster frontend — builds the Vite bundle, then serves it with nginx.
# nginx also proxies /api to the backend container (see nginx.conf), so the
# browser only ever talks to one origin: no CORS in production.

# ------------------------------------------------------------ build stage
FROM node:20-alpine AS build
WORKDIR /build

COPY package.json ./
# The repo ships no lockfile yet, so `npm install` resolves the semver
# ranges above. Switch to `npm ci` the moment package-lock.json is committed.
RUN npm install

COPY . .
# `build` = tsc -b && vite build → dist/
RUN npm run build

# -------------------------------------------------------- runtime stage
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html

EXPOSE 80
# No HEALTHCHECK here: compose runs one with the same wget probe (busybox).
