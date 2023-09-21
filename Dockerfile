FROM node:16.14.0

WORKDIR /app

RUN apt update

COPY . .

ARG NPM_TOKEN

RUN npm publish
