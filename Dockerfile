FROM node:22-bookworm-slim

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    WARUNG_SAAS=1

COPY api api
RUN cd api && npm ci --omit=dev

COPY frontend frontend
RUN cd frontend && npm ci && npx gulp build && rm -rf node_modules

ENV NODE_ENV=production
WORKDIR /app/api
CMD ["node", "server.js"]
