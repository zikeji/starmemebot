FROM node:25-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
ARG COMMIT_SHA
ENV COMMIT_SHA=$COMMIT_SHA
RUN npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]
