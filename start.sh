#!/bin/bash

# Kill any existing aria2c processes
pkill aria2c || true

# Create necessary directories and set permissions
mkdir -p /app/logs /etc/aria2 /app/downloads
chmod -R 755 /app /etc/aria2 /app/downloads

# Configure aria2
cat > /etc/aria2/aria2.conf << EOF
dir=/app/downloads
disable-ipv6=true
enable-rpc=true
rpc-listen-port=6800
rpc-listen-all=false
rpc-allow-origin-all=true
rpc-secret=${ARIA2_SECRET}
continue=true
max-concurrent-downloads=3
max-connection-per-server=10
min-split-size=10M
split=10
EOF

# Start aria2c in the background
echo "Starting aria2c..."
aria2c --conf-path=/etc/aria2/aria2.conf \
       --log=/app/logs/aria2c.log \
       --log-level=info &

# Wait for aria2c to start
echo "Waiting for aria2c to start..."
sleep 5

# Verify aria2c is running and responding
if ! pgrep aria2c > /dev/null; then
    echo "Error: aria2c failed to start"
    cat /app/logs/aria2c.log
    exit 1
fi

# Test RPC connection
curl -s "http://127.0.0.1:6800/jsonrpc" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"aria2.getVersion","id":"test","params":["token:'${ARIA2_SECRET}'"]}' || {
    echo "Error: aria2c RPC test failed"
    exit 1
}

echo "aria2c started successfully"

# Start the Node.js app
echo "Starting Node.js application..."
exec node src/index.js
