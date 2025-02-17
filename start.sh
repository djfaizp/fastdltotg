#!/bin/sh

# Start aria2c in the background
echo "Starting aria2c..."
aria2c --enable-rpc --rpc-listen-all=true --rpc-allow-origin-all --rpc-secret=P3TERX --rpc-listen-port=6800 &

# Wait for aria2c to start
sleep 2

# Start the Node.js app
echo "Starting Node.js application..."
node src/index.js
