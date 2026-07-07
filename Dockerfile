FROM node:20.13.1-alpine AS BUILDER
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install && yarn cache clean
COPY . .
RUN yarn build

FROM node:20.13.1-alpine

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
ENV NODE_ENV=production

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install && yarn cache clean
COPY --from=BUILDER /app/build ./build
COPY --from=BUILDER /app/frontend/dist ./frontend/dist
COPY config ./config
RUN yarn install && yarn cache clean && ls config
# To ensure build success when .env is not exist.
COPY .env* ./

CMD ["node", "build/bootstrap"]
