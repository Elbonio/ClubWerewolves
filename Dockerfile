FROM node:slim AS install
WORKDIR /app
COPY ./package.json ./package-lock.json /app/
RUN npm install

FROM node:slim AS run
WORKDIR /app
COPY --from=install /app/ /app/
COPY *.js *.html /app/

ENV TINI_VERSION=v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini
ENTRYPOINT ["/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]

CMD [ "node", "server.js" ]
