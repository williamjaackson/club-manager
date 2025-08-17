# 1) base image already adds a non-root user 'pptruser' by default
FROM ghcr.io/puppeteer/puppeteer:21.7.0

# 2) switch to root so we can write into /usr/src/app
USER root

# 3) set the working directory
WORKDIR /usr/src/app

# 4) copy only package files and install as root
COPY package*.json ./
RUN npm install

# 5) copy the rest of the source, build TS and install Chrome browser
COPY . .
RUN npx tsc
RUN npx puppeteer browsers install chrome

# 6) chown the entire app folder back to pptruser
RUN chown -R pptruser:pptruser /usr/src/app

# 7) switch back to the non-root user for safety
USER pptruser

# 8) expose & run
EXPOSE 3000
CMD ["node", "dist/index.js"]