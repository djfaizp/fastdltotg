FROM node:latest

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
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install production dependencies and clean up
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application files
COPY . .

# Make start script executable
RUN chmod +x start.sh

EXPOSE 1234 6800

CMD ["./start.sh"]
