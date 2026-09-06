# Container image for any Docker host (Fly.io, Railway, a VPS, etc.)
FROM node:22-alpine

WORKDIR /app

# Install production dependencies first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
# The server reads PORT from the environment (defaults to 3000).
EXPOSE 3000

CMD ["node", "server.js"]
