FROM debian:12-slim

RUN apt-get update && apt-get install -y curl \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && npm install -g yarn \
  && apt-get clean

WORKDIR /app
COPY . /app
RUN yarn install

CMD ["sh", "-c", "yarn start-$CLIENT_TYPE"]
