FROM node:16.14.0

WORKDIR /app

RUN apt update

COPY package.json .

COPY package-lock.json .

RUN npm install

COPY . .

ARG NPM_TOKEN

RUN npm publish
