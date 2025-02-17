#!/bin/sh

# Start aria2c in the background
aria2c --enable-rpc --rpc-listen-all=true --rpc-allow-origin-all --rpc-secret=P3TERX --rpc-listen-port=6800 &

# Start the Node.js app
node src/index.js