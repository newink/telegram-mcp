FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY src/ src/
COPY tsconfig.json .
RUN mkdir -p bot-data
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
