#!/bin/sh
set -e

# Si la carpeta sessions existe, aseguramos que pertenezca al usuario node
if [ -d "/app/sessions" ]; then
    echo "🔧 Ajustando permisos de /app/sessions..."
    chown -R node:node /app/sessions
fi

# Ejecutar el comando original como el usuario 'node'
# usamos su-exec (nativo de Alpine) para cambiar de root -> node
exec su-exec node "$@"
