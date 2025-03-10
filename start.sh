#!/bin/bash
# Install NVM (Node Version Manager) if not installed
apt-get update && apt-get install -y \
    chromium \
    xvfb \
    fonts-freefont-ttf \
    fonts-roboto \
    && rm -rf /var/lib/apt/lists/*
if [ ! -d "$HOME/.nvm" ]; then
    echo "📥 Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || { echo "❌ NVM installation failed"; exit 1; }
else
    echo "✅ NVM is already installed"
fi

# Load NVM
echo "🔄 Loading NVM..."
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install the latest LTS version of Node.js
if ! command -v node &> /dev/null; then
    echo "📥 Installing Node.js LTS version..."
    nvm install --lts || { echo "❌ Node.js installation failed"; exit 1; }
else
    echo "✅ Node.js is already installed"
fi

# Install project dependencies
echo "📦 Installing NPM dependencies..."
npm install || { echo "❌ NPM install failed"; exit 1; }
npm install -g npm@11.1.0
# Start Aria2c
echo "🚀 Starting Aria2c with RPC enabled..."
aria2c --enable-rpc --rpc-listen-all=true --rpc-allow-origin-all &

# Start the application
echo "🚀 Starting application..."
! npm start