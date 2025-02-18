FROM node:23.1.0-slim

# Install dependencies in a single RUN to reduce layers
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg \
    ca-certificates \
    apt-transport-https \
    chromium \
    chromium-driver \
    xvfb \
    aria2 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Combine npm commands and remove npm cache
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application files
COPY . .

# Make start script executable
RUN chmod +x start.sh

EXPOSE 1234 6800

CMD ["./start.sh"]
