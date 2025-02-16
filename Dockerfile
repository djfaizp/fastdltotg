FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    fonts-freefont-ttf \
    fonts-roboto \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for Puppeteer
ENV CHROME_BIN=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DISPLAY=:99 \
    XVFB_WHD=1280x1024x16

# Create and configure directories
RUN mkdir -p /app/chrome-data /downloads && \
    chown -R node:node /app /downloads && \
    chmod -R 755 /downloads

WORKDIR /app

# Copy package files and install dependencies
COPY --chown=node:node package*.json ./
RUN npm install --production --omit=dev

# Copy application files
COPY --chown=node:node . .

# Switch to non-root user
USER node

# Expose application port
EXPOSE 1234

# Start application with Xvfb wrapper
CMD ["sh", "-c", "Xvfb :99 -ac -screen 0 $XVFB_WHD -nolisten tcp & npm start"]