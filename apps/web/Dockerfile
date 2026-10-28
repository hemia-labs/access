FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN npm install -g bun@1.3.14
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1 ACCESS_API_URL=http://api:3019
RUN cd apps/web && bun run build

# Keep Debian/glibc and the same Node binary, without npm, Yarn or Node headers.
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --create-home --shell /bin/sh node
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
LABEL org.opencontainers.image.source="https://github.com/hemia-labs/access"
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 ACCESS_API_URL=http://api:3019
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
