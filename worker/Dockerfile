FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache \
    openjdk11 \
    python3 \
    build-base \
    rust \
    cargo

RUN npm install -g typescript

WORKDIR /app
COPY package*.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist

RUN mkdir -p executionArea

CMD ["node", "dist/index.js"]