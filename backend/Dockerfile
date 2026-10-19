FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY server.js ./
EXPOSE 8080
USER node
CMD ["npm", "start"]
