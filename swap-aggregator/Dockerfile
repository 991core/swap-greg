# Official multi-platform index read from Docker Hub on 2026-10-04.
FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG NEXT_PUBLIC_RELEASE_MODE=quotes
ARG NEXT_PUBLIC_PLATFORM_FEE_PERCENT=0
ARG HERMES_SOURCE_REVISION=unrecorded
ARG HERMES_SOURCE_TREE=unrecorded
ENV NEXT_PUBLIC_RELEASE_MODE=$NEXT_PUBLIC_RELEASE_MODE \
    NEXT_PUBLIC_PLATFORM_FEE_PERCENT=$NEXT_PUBLIC_PLATFORM_FEE_PERCENT
# Explicit source copies; local .env files, operator configs and evidence never enter a layer.
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY security ./security
COPY next.config.js tsconfig.json next-env.d.ts .eslintrc.json ./
RUN node -e "if (!['quotes','enabled','incident'].includes(process.env.NEXT_PUBLIC_RELEASE_MODE)) process.exit(1)" \
    && npm run build

FROM node:22.23.3-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
ARG HERMES_SOURCE_REVISION=unrecorded
ARG HERMES_SOURCE_TREE=unrecorded
ARG NEXT_PUBLIC_RELEASE_MODE=quotes
ARG NEXT_PUBLIC_PLATFORM_FEE_PERCENT=0
LABEL org.opencontainers.image.title="Hermes" \
      org.opencontainers.image.revision=$HERMES_SOURCE_REVISION \
      org.hermes.source-tree=$HERMES_SOURCE_TREE \
      org.hermes.release-mode=$NEXT_PUBLIC_RELEASE_MODE \
      org.hermes.platform-fee-percent=$NEXT_PUBLIC_PLATFORM_FEE_PERCENT
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 10001 hermes && useradd --uid 10001 --gid hermes --no-create-home --shell /usr/sbin/nologin hermes
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /app/public ./public
RUN mkdir -p /app/.next/cache && chown 10001:10001 /app/.next/cache
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
