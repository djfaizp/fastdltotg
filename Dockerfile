FROM node:18-slim

# Install dependencies required by puppeteer-real-browser and aria2
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    xvfb \
    libxss1 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libxdamage1 \
    libxfixes3 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy all the code
COPY . .

# Expose a port if your app listens on one (adjust if needed)
EXPOSE 1234

# Start the app
CMD ["npm", "start"]
