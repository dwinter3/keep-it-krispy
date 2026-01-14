FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for environment variables
ARG SITE_PASSWORD
ARG KRISP_S3_BUCKET
ARG DYNAMODB_TABLE
ARG VECTOR_BUCKET
ARG VECTOR_INDEX
ARG APP_REGION
ARG S3_ACCESS_KEY_ID
ARG S3_SECRET_ACCESS_KEY

ENV SITE_PASSWORD=$SITE_PASSWORD
ENV KRISP_S3_BUCKET=$KRISP_S3_BUCKET
ENV DYNAMODB_TABLE=$DYNAMODB_TABLE
ENV VECTOR_BUCKET=$VECTOR_BUCKET
ENV VECTOR_INDEX=$VECTOR_INDEX
ENV APP_REGION=$APP_REGION
ENV S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
ENV S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
