FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
# npm ci ki jagah npm install use karein taake lockfile ka issue na aye
RUN npm install --omit=dev

# --- Final Runner Stage ---
FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

USER node

COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node server.js ./

EXPOSE 5000

CMD ["node", "server.js"]