# syntax=docker/dockerfile:1.6
# ============================================================================
# Auth Server Management — Next.js 14 (App Router)
#
# Multi-stage build:
#   1. deps     — installs node_modules using the lockfile
#   2. builder  — compiles the Next.js production bundle
#   3. runner   — minimal runtime image with only what's needed
#
# Tips for fast rebuilds:
#   - Changes to source code under `app/` re-use cached `node_modules` and
#     the pre-built `.next` assets
#   - Changes to `package.json` / `package-lock.json` invalidate only the
#     deps layer
#   - `next start` boots in ~200ms (vs 5-15s for `next dev`)
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1: install dependencies (cached unless package*.json change)
# ----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `--prefer-offline` falls back to cache when possible; `--no-audit --no-fund`
# skips noisy (and slow) npm post-install network calls.
RUN npm ci --no-audit --no-fund --prefer-offline

# ----------------------------------------------------------------------------
# Stage 2: build the Next.js production bundle
# ----------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ----------------------------------------------------------------------------
# Stage 3: minimal runtime image
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOST=0.0.0.0
ENV PORT=3000

# Drop privileges
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy the production build artifacts
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
