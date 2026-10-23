# pump.fun starter on the TrenchyTools API: one Next.js server in one container.
# Your wallet files are the only state. Mount a volume at /data; they are written to /data/wallets
# (the rule: nothing is funded unless its file is there). Pass TRENCHY_API_KEY as an environment variable.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 WALLET_BACKUP_DIR=/data/wallets
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
VOLUME ["/data"]
CMD ["sh", "-c", "mkdir -p /data/wallets && node server.js"]
