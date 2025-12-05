FROM node:20-alpine

WORKDIR /app

# 1. Instalar dependencias del sistema (su-exec es necesario para el entrypoint)
RUN apk add --no-cache su-exec

# 2. Instalar dependencias de Node
COPY package.json ./
RUN npm install --production

# 3. Copiar el código fuente
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# 4. Descargar Alpine.js localmente
RUN mkdir -p public/js && \
    wget -O public/js/alpine.js https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js

# 5. Permisos iniciales para el código estático
RUN chown -R node:node /app

# 6. Variables de entorno por defecto
ENV PORT=8001
EXPOSE 8001

# 7. Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/me || exit 1

# --- CAMBIOS CLAVE AQUÍ ---

# Hacemos ejecutable el script de entrada
RUN chmod +x scripts/entrypoint.sh

# NOTA: Ya NO usamos "USER node" aquí. 
# Arrancamos como root para que el entrypoint pueda hacer 'chown', 
# y el entrypoint se encargará de cambiar a 'node'.

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["node", "src/server.js"]
