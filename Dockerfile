# STOQWISE — produktionsimage.
# En process, ingen byggkedja: Bun kör TypeScript direkt. Databasen (SQLite)
# ligger på en monterad volym i /data, eftersom containerns övriga filsystem är
# tillfälligt och töms vid varje deploy.
FROM oven/bun:1.4-slim

WORKDIR /app

# Beroenden först, så att lager-cachen håller när bara källkoden ändras.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

# Skapas av plattformen när volymen monteras; raden gör lokala körningar möjliga.
RUN mkdir -p /data

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/lagerradar.db

EXPOSE 3000

# Migreringar körs vid start; en misslyckad migrering stoppar processen.
CMD ["bun", "src/server.ts"]
