FROM ghcr.io/puppeteer/puppeteer:21.7.0
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx tsc
EXPOSE 3000
CMD ["node", "dist/index.js"]