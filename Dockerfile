FROM node:20-alpine

WORKDIR /app

# 1. Instalar dependencias
COPY package.json ./
RUN npm install --production

# 2. Copiar el código fuente
COPY src ./src
COPY public ./public

# 3. Descargar Alpine.js localmente (para no depender de CDN externo en tiempo de ejecución)
RUN mkdir -p public/js && \
    wget -O public/js/alpine.js https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js

# 4. Variables de entorno por defecto
ENV PORT=8001

EXPOSE 8001

# 5. Healthcheck (Verificación de estado)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/me || exit 1

# 6. PERMISOS (CRÍTICO): Asignar propiedad de la carpeta /app al usuario 'node'
# Esto debe hacerse ANTES de cambiar de usuario.
RUN chown -R node:node /app

# 7. Seguridad: Cambiar al usuario sin privilegios
USER node

CMD ["node", "src/server.js"]
