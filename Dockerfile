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

# Healthcheck para verificar que el servicio responde
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/me || exit 1

# Usar usuario no-root por seguridad
USER node

CMD ["node", "src/server.js"]
