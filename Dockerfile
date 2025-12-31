FROM node:22.21.1-alpine

WORKDIR /app

RUN apk update

COPY package.json .

COPY package-lock.json .

COPY setup.js .

RUN npm install

COPY . .

ARG NPM_TOKEN

RUN npm publish --access public
