FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

ENV NEXT_PUBLIC_AUTH_SERVER_URL=http://localhost:8000
ENV HOST=0.0.0.0

CMD ["npm", "run", "dev"]
