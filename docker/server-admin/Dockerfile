# syntax=docker/dockerfile:1
# Creezio Server Admin — admin web multi-serveurs Docker (@creezio/fleet).
#
# Build context = contexte STAGÉ par `creezio server-docker admin up`
# (stageFleetImageContext) : fleet-collector/ (collector télémétrie) +
# node_modules/@creezio/fleet (package.json + dist + public).
# Le backend est compilé depuis packages/fleet/src (TS) — fail-closed si
# le dist est absent (npm run build:packages).
#
# Run (fait par `creezio server-docker admin up`) :
#   --network host                          (boot-status des serveurs via 127.0.0.1:<port>)
#   -v /var/run/docker.sock:/var/run/docker.sock
#   -v <brandRoot>:<brandRoot>              (registres servers.json + data, mêmes chemins)
#   -e CREEZIO_ADMIN_PASS=…                 (obligatoire)
#   -e CREEZIO_ADMIN_BRAND_ROOTS=/opt/docker/tempoflow3[:…]

FROM node:22-bookworm-slim

WORKDIR /app
COPY . .

ENV NODE_ENV=production \
    CREEZIO_ADMIN_PORT=18800 \
    CREEZIO_ADMIN_HOST=127.0.0.1

EXPOSE 18800

# Sonde authentifi?e : /admin/api/health (Basic depuis les env du conteneur).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const u=process.env.CREEZIO_ADMIN_USER||'admin',p=process.env.CREEZIO_ADMIN_PASS||'';fetch('http://'+(process.env.CREEZIO_ADMIN_HOST||'127.0.0.1')+':'+(process.env.CREEZIO_ADMIN_PORT||18800)+'/admin/api/health',{headers:{authorization:'Basic '+Buffer.from(u+':'+p).toString('base64')}}).then(r=>r.json()).then(j=>process.exit(j&&j.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "node_modules/@creezio/fleet/dist/bin/server-admin-main.js"]
