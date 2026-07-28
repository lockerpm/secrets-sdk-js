FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd

WORKDIR /app

COPY package.json .
COPY package-lock.json .
RUN npm ci --ignore-scripts

COPY . .

RUN node scripts/verify-ci-supply-chain.mjs \
    && npm audit --audit-level=high \
    && npm test

CMD ["npm", "test"]
