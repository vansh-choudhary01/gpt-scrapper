FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

RUN npx playwright install

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]