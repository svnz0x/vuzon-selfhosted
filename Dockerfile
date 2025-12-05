FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package.json ./
RUN npm install --production

# Copiar el código fuente
COPY src ./src
COPY public ./public

# NUEVO: Descargar Alpine.js localmente dentro de la imagen
RUN mkdir -p public/js && \
    wget -O public/js/alpine.js https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js

# Variables de entorno por defecto
ENV PORT=8001

EXPOSE 8001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/me || exit 1

# Seguridad: Ejecutar como usuario sin privilegios
USER node

CMD ["node", "src/server.js"]
