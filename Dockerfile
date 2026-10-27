FROM oven/bun:1-slim
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY agent ./agent
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
COPY demo.ts ./

ENV NODE_ENV=production
EXPOSE 3000
# La clave (ANTHROPIC_API_KEY) se inyecta como variable de entorno del servicio, nunca en la imagen.
CMD ["bun", "src/server.ts"]
