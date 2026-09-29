# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/*.conf /etc/nginx/dtat/
COPY --chmod=755 nginx/40-dtat-config.sh /docker-entrypoint.d/40-dtat-config.sh
# The stock default.conf is replaced at start-up by 40-dtat-config.sh (HTTP or HTTPS variant).
RUN rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80 443
