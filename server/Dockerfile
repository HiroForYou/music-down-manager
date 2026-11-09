FROM node:22-slim

# Pinned yt-dlp release. YouTube changes often: bump this when downloads start failing.
ARG YTDLP_VERSION=2026.07.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY server.js ./
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production \
    PORT=3008
EXPOSE 3008

# Spotify likes, library backup and stream cache.
VOLUME ["/app/data"]

USER node
CMD ["node", "server.js"]
