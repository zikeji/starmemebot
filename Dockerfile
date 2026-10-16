FROM node:25-slim

WORKDIR /app

COPY package.json package-lock.json* ./
# better-sqlite3 ships prebuilt binaries, but its binding.gyp makes npm run
# node-gyp rebuild, which needs a toolchain slim doesn't have.
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

ARG COMMIT_SHA
ENV COMMIT_SHA=$COMMIT_SHA
ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
CMD ["node", "dist/index.js"]
