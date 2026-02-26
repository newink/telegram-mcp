FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY src/ src/
COPY tsconfig.json .
RUN bun build src/index.ts --outfile dist/index.js --target bun

FROM oven/bun:1-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist dist/
RUN mkdir -p bot-data && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/mcp || exit 1
CMD ["bun", "run", "dist/index.js"]
