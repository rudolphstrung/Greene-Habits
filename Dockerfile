FROM node:22-alpine

# better-sqlite3 est un module natif : sa compilation demande une toolchain.
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV DB_PATH=/data/greene.db
EXPOSE 3000

CMD ["node", "src/server.js"]
