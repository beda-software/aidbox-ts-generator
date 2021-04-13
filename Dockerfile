FROM node:lts as builder


RUN mkdir -p /app

WORKDIR /app

ADD package.json package.json
ADD yarn.lock yarn.lock

RUN yarn --network-concurrency=1

ADD . /app

ENTRYPOINT ["yarn", "generate"]
