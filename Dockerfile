FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# --- Dependencies ---
FROM base AS deps

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY src/core/package.json src/core/package.json
COPY src/paw-sdk/package.json src/paw-sdk/package.json
COPY src/skill-sdk/package.json src/skill-sdk/package.json
COPY paws/paw-dashboard/package.json paws/paw-dashboard/package.json
COPY paws/paw-mcp/package.json paws/paw-mcp/package.json
COPY paws/paw-telegram/package.json paws/paw-telegram/package.json
COPY paws/paw-ollama/package.json paws/paw-ollama/package.json
COPY paws/paw-shell/package.json paws/paw-shell/package.json
COPY paws/paw-browser/package.json paws/paw-browser/package.json
COPY paws/paw-filesystem/package.json paws/paw-filesystem/package.json

RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --- Build ---
FROM deps AS build

COPY tsconfig.base.json ./
COPY biome.json ./

COPY src/core/src src/core/src
COPY src/core/tsconfig.json src/core/tsconfig.json
COPY src/core/tsup.config.ts src/core/tsup.config.ts

COPY src/paw-sdk/src src/paw-sdk/src
COPY src/paw-sdk/tsconfig.json src/paw-sdk/tsconfig.json
COPY src/paw-sdk/tsup.config.ts src/paw-sdk/tsup.config.ts

COPY src/skill-sdk/src src/skill-sdk/src
COPY src/skill-sdk/tsconfig.json src/skill-sdk/tsconfig.json
COPY src/skill-sdk/tsup.config.ts src/skill-sdk/tsup.config.ts

COPY paws/paw-dashboard/src paws/paw-dashboard/src
COPY paws/paw-dashboard/tsconfig.json paws/paw-dashboard/tsconfig.json
COPY paws/paw-dashboard/tsup.config.ts paws/paw-dashboard/tsup.config.ts
COPY paws/paw-dashboard/vole-paw.json paws/paw-dashboard/vole-paw.json

COPY paws/paw-mcp/src paws/paw-mcp/src
COPY paws/paw-mcp/tsconfig.json paws/paw-mcp/tsconfig.json
COPY paws/paw-mcp/tsup.config.ts paws/paw-mcp/tsup.config.ts
COPY paws/paw-mcp/vole-paw.json paws/paw-mcp/vole-paw.json

COPY paws/paw-telegram/src paws/paw-telegram/src
COPY paws/paw-telegram/tsconfig.json paws/paw-telegram/tsconfig.json
COPY paws/paw-telegram/tsup.config.ts paws/paw-telegram/tsup.config.ts
COPY paws/paw-telegram/vole-paw.json paws/paw-telegram/vole-paw.json

COPY paws/paw-ollama/src paws/paw-ollama/src
COPY paws/paw-ollama/tsconfig.json paws/paw-ollama/tsconfig.json
COPY paws/paw-ollama/tsup.config.ts paws/paw-ollama/tsup.config.ts
COPY paws/paw-ollama/vole-paw.json paws/paw-ollama/vole-paw.json

COPY paws/paw-shell/src paws/paw-shell/src
COPY paws/paw-shell/tsconfig.json paws/paw-shell/tsconfig.json
COPY paws/paw-shell/tsup.config.ts paws/paw-shell/tsup.config.ts
COPY paws/paw-shell/vole-paw.json paws/paw-shell/vole-paw.json

COPY paws/paw-browser/src paws/paw-browser/src
COPY paws/paw-browser/tsconfig.json paws/paw-browser/tsconfig.json
COPY paws/paw-browser/tsup.config.ts paws/paw-browser/tsup.config.ts
COPY paws/paw-browser/vole-paw.json paws/paw-browser/vole-paw.json

COPY paws/paw-filesystem/src paws/paw-filesystem/src
COPY paws/paw-filesystem/tsconfig.json paws/paw-filesystem/tsconfig.json
COPY paws/paw-filesystem/tsup.config.ts paws/paw-filesystem/tsup.config.ts
COPY paws/paw-filesystem/vole-paw.json paws/paw-filesystem/vole-paw.json

RUN pnpm build

# --- Production ---
FROM base AS production

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/src/core/dist ./src/core/dist
COPY --from=build /app/src/core/package.json ./src/core/
COPY --from=build /app/src/paw-sdk/dist ./src/paw-sdk/dist
COPY --from=build /app/src/paw-sdk/package.json ./src/paw-sdk/
COPY --from=build /app/src/skill-sdk/dist ./src/skill-sdk/dist
COPY --from=build /app/src/skill-sdk/package.json ./src/skill-sdk/
COPY --from=build /app/paws/paw-dashboard/dist ./paws/paw-dashboard/dist
COPY --from=build /app/paws/paw-dashboard/package.json ./paws/paw-dashboard/
COPY --from=build /app/paws/paw-dashboard/vole-paw.json ./paws/paw-dashboard/
COPY --from=build /app/paws/paw-mcp/dist ./paws/paw-mcp/dist
COPY --from=build /app/paws/paw-mcp/package.json ./paws/paw-mcp/
COPY --from=build /app/paws/paw-mcp/vole-paw.json ./paws/paw-mcp/
COPY --from=build /app/paws/paw-telegram/dist ./paws/paw-telegram/dist
COPY --from=build /app/paws/paw-telegram/package.json ./paws/paw-telegram/
COPY --from=build /app/paws/paw-telegram/vole-paw.json ./paws/paw-telegram/
COPY --from=build /app/paws/paw-ollama/dist ./paws/paw-ollama/dist
COPY --from=build /app/paws/paw-ollama/package.json ./paws/paw-ollama/
COPY --from=build /app/paws/paw-ollama/vole-paw.json ./paws/paw-ollama/
COPY --from=build /app/paws/paw-shell/dist ./paws/paw-shell/dist
COPY --from=build /app/paws/paw-shell/package.json ./paws/paw-shell/
COPY --from=build /app/paws/paw-shell/vole-paw.json ./paws/paw-shell/
COPY --from=build /app/paws/paw-browser/dist ./paws/paw-browser/dist
COPY --from=build /app/paws/paw-browser/package.json ./paws/paw-browser/
COPY --from=build /app/paws/paw-browser/vole-paw.json ./paws/paw-browser/
COPY --from=build /app/paws/paw-filesystem/dist ./paws/paw-filesystem/dist
COPY --from=build /app/paws/paw-filesystem/package.json ./paws/paw-filesystem/
COPY --from=build /app/paws/paw-filesystem/vole-paw.json ./paws/paw-filesystem/

RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

# Copy config and assets
COPY vole.config.mjs ./
COPY assets/ ./assets/

RUN echo '#!/bin/sh' > /usr/local/bin/vole && \
    echo 'exec node /app/src/core/dist/cli.js "$@"' >> /usr/local/bin/vole && \
    chmod +x /usr/local/bin/vole

EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["vole"]
CMD ["start"]

# --- Development ---
FROM deps AS development

COPY tsconfig.base.json ./
COPY biome.json ./

COPY src/core/src src/core/src
COPY src/core/tsconfig.json src/core/tsconfig.json
COPY src/core/tsup.config.ts src/core/tsup.config.ts

COPY src/paw-sdk/src src/paw-sdk/src
COPY src/paw-sdk/tsconfig.json src/paw-sdk/tsconfig.json
COPY src/paw-sdk/tsup.config.ts src/paw-sdk/tsup.config.ts

COPY src/skill-sdk/src src/skill-sdk/src
COPY src/skill-sdk/tsconfig.json src/skill-sdk/tsconfig.json
COPY src/skill-sdk/tsup.config.ts src/skill-sdk/tsup.config.ts

COPY paws/paw-dashboard/src paws/paw-dashboard/src
COPY paws/paw-dashboard/tsconfig.json paws/paw-dashboard/tsconfig.json
COPY paws/paw-dashboard/tsup.config.ts paws/paw-dashboard/tsup.config.ts
COPY paws/paw-dashboard/vole-paw.json paws/paw-dashboard/vole-paw.json

COPY paws/paw-mcp/src paws/paw-mcp/src
COPY paws/paw-mcp/tsconfig.json paws/paw-mcp/tsconfig.json
COPY paws/paw-mcp/tsup.config.ts paws/paw-mcp/tsup.config.ts
COPY paws/paw-mcp/vole-paw.json paws/paw-mcp/vole-paw.json

COPY paws/paw-telegram/src paws/paw-telegram/src
COPY paws/paw-telegram/tsconfig.json paws/paw-telegram/tsconfig.json
COPY paws/paw-telegram/tsup.config.ts paws/paw-telegram/tsup.config.ts
COPY paws/paw-telegram/vole-paw.json paws/paw-telegram/vole-paw.json

COPY paws/paw-ollama/src paws/paw-ollama/src
COPY paws/paw-ollama/tsconfig.json paws/paw-ollama/tsconfig.json
COPY paws/paw-ollama/tsup.config.ts paws/paw-ollama/tsup.config.ts
COPY paws/paw-ollama/vole-paw.json paws/paw-ollama/vole-paw.json

COPY paws/paw-shell/src paws/paw-shell/src
COPY paws/paw-shell/tsconfig.json paws/paw-shell/tsconfig.json
COPY paws/paw-shell/tsup.config.ts paws/paw-shell/tsup.config.ts
COPY paws/paw-shell/vole-paw.json paws/paw-shell/vole-paw.json

COPY paws/paw-browser/src paws/paw-browser/src
COPY paws/paw-browser/tsconfig.json paws/paw-browser/tsconfig.json
COPY paws/paw-browser/tsup.config.ts paws/paw-browser/tsup.config.ts
COPY paws/paw-browser/vole-paw.json paws/paw-browser/vole-paw.json

COPY paws/paw-filesystem/src paws/paw-filesystem/src
COPY paws/paw-filesystem/tsconfig.json paws/paw-filesystem/tsconfig.json
COPY paws/paw-filesystem/tsup.config.ts paws/paw-filesystem/tsup.config.ts
COPY paws/paw-filesystem/vole-paw.json paws/paw-filesystem/vole-paw.json

COPY vole.config.mjs ./
COPY assets/ ./assets/

RUN pnpm build

RUN echo '#!/bin/sh' > /usr/local/bin/vole && \
    echo 'exec node /app/src/core/dist/cli.js "$@"' >> /usr/local/bin/vole && \
    chmod +x /usr/local/bin/vole

ENV NODE_ENV=development

CMD ["pnpm", "build"]
