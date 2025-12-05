FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package.json ./
RUN npm install --production

# Copiar el código fuente
COPY src ./src
COPY public ./public

# Variables de entorno por defecto
ENV PORT=8001

EXPOSE 8001

CMD ["node", "src/server.js"]
