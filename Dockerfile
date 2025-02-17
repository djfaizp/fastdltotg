FROM node:18-slim

# Install dependencies in a single RUN to reduce layers
RUN apt-get update && apt-get install -y \
    wget \
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

# Configure aria2
RUN mkdir -p /etc/aria2 && \
    chmod 755 /etc/aria2 && \
    touch /etc/aria2/aria2.conf && \
    chmod 644 /etc/aria2/aria2.conf && \
    echo "disable-ipv6=true\n\
rpc-listen-all=true\n\
rpc-allow-origin-all=true\n\
rpc-listen-port=6800\n\
enable-rpc=true\n\
rpc-secret=P3TERX" > /etc/aria2/aria2.conf

# Make start script executable
RUN chmod +x start.sh

EXPOSE 1234 6800

CMD ["./start.sh"]
