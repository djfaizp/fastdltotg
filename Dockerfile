FROM node:latest

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

COPY package*.json ./

RUN npm update
RUN npm install
COPY . .

EXPOSE 1234

# Create aria2 config directory and set permissions
RUN mkdir -p /etc/aria2 && \
    chmod 755 /etc/aria2 && \
    touch /etc/aria2/aria2.conf && \
    chmod 644 /etc/aria2/aria2.conf && \
    echo "disable-ipv6=true" >> /etc/aria2/aria2.conf && \
    echo "rpc-listen-all=true" >> /etc/aria2/aria2.conf && \
    echo "rpc-allow-origin-all=true" >> /etc/aria2/aria2.conf && \
    echo "rpc-listen-port=6800" >> /etc/aria2/aria2.conf && \
    echo "enable-rpc=true" >> /etc/aria2/aria2.conf && \
    echo "rpc-secret=P3TERX" >> /etc/aria2/aria2.conf



RUN chmod +x start.sh
CMD ["./start.sh"]