FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY miniprogram ./miniprogram
COPY server ./server
RUN npm run build

FROM node:24.16.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/app/data/jumeng.sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/miniprogram/data ./miniprogram/data
COPY package.json ./
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 8787
CMD ["node", "dist/server/index.js"]
