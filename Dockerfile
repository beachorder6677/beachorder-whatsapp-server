# Use Node.js 20 slim como base
FROM node:20-slim

# Instalar dependências do Chromium necessárias para whatsapp-web.js
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Definir variáveis para o Puppeteer usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Criar diretório da aplicação
WORKDIR /app

# Copiar package.json primeiro (para cache de layers)
COPY package*.json ./

# Instalar dependências de produção
RUN npm install --production

# Copiar código fonte
COPY . .

# Criar diretório para sessões WhatsApp
RUN mkdir -p whatsapp-sessions && chmod 777 whatsapp-sessions

# Expor porta
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Comando para iniciar
CMD ["npm", "start"]
