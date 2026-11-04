FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY scripts/build-course.mjs ./scripts/build-course.mjs
COPY miniprogram ./miniprogram
COPY server ./server
RUN npm run build

FROM node:24.16.0-bookworm-slim
WORKDIR /app
# CloudRun injects its OpenAPI certificate at runtime; retain TLS verification.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/app/data/jumeng.sqlite AUTH_MODE=wechat AI_MODE=deepseek
COPY --from=build /app/dist ./dist
COPY --from=build /app/miniprogram/data ./miniprogram/data
COPY admin ./admin
COPY package.json ./
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 8787
CMD ["node", "--use-system-ca", "dist/server/index.js"]
