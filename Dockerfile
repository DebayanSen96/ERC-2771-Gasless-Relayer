# ---------- Build & runtime image ----------
# Use a slim Alpine Node image
FROM node:20-alpine as base

# 1. Set working dir
WORKDIR /app

# 2. Copy package manifests first and install deps (better cache)
COPY package*.json tsconfig.json ./
RUN npm ci

# 3. Copy the rest of the project
COPY . .

# 4. Expose the relay port
ENV PORT=3000
EXPOSE 3000

# 5. Environment variables expected at runtime
#    RPC_URL           – L2 RPC endpoint (e.g. https://sepolia.base.org)
#    SPONSOR_PRIVATE_KEY – Private key that pays gas (0x...)
#    FORWARDER_ADDRESS  – Deployed MinimalForwarder address
#    RELAYER_PORT       – (optional) overrides 3000

# 6. Start the relayer
CMD ["npx", "ts-node", "scripts/server.ts"]
