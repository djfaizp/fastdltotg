#!/bin/bash

# Kill any existing aria2c processes
pkill aria2c || true

# Create necessary directories and set permissions
mkdir -p /app/logs /etc/aria2 /app/downloads
chmod -R 755 /app /etc/aria2 /app/downloads

# Configure aria2 with enhanced settings
cat > /etc/aria2/aria2.conf << EOF
# Basic Settings
dir=/app/downloads
disable-ipv6=true
enable-rpc=true
rpc-listen-port=6800
rpc-listen-all=false
rpc-allow-origin-all=true
rpc-secret=${ARIA2_SECRET}

# Download Settings
continue=true
max-concurrent-downloads=3
max-connection-per-server=16
min-split-size=1M
split=1
file-allocation=none
allow-piece-length-change=false
auto-file-renaming=true

# Retry Settings
max-tries=10
retry-wait=10
connect-timeout=30
timeout=600
max-file-not-found=5
max-resume-failure-tries=5
retry-on-400=true
retry-on-403=true
retry-on-406=true
retry-on-unknown=true

# Performance Settings
async-dns=true
enable-http-keep-alive=true
enable-http-pipelining=true
stream-piece-selector=inorder
conditional-get=true
no-netrc=true
reuse-uri=true
http-accept-gzip=true
optimize-concurrent-downloads=true

# Logging Settings
log=/app/logs/aria2c.log
log-level=info
console-log-level=warn
summary-interval=120

# Advanced Settings
event-poll=epoll
human-readable=true
file-allocation=none
disk-cache=64M
EOF

# Start aria2c in the background with enhanced settings
echo "Starting aria2c..."
aria2c --conf-path=/etc/aria2/aria2.conf \
       --log=/app/logs/aria2c.log \
       --log-level=info \
       --quiet=true &

# Enhanced startup check
echo "Waiting for aria2c to start..."
for i in {1..30}; do
    if pgrep aria2c > /dev/null; then
        break
    fi
    if [ $i -eq 30 ]; then
        echo "Error: aria2c failed to start after 30 seconds"
        cat /app/logs/aria2c.log
        exit 1
    fi
    sleep 1
done

# Enhanced RPC connection test with retry
MAX_RETRIES=5
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
    echo "Testing RPC connection (attempt $i/$MAX_RETRIES)..."
    if curl -s "http://127.0.0.1:6800/jsonrpc" \
         -H "Content-Type: application/json" \
         -d '{"jsonrpc":"2.0","method":"aria2.getVersion","id":"test","params":["token:'${ARIA2_SECRET}'"]}' | grep -q "version"; then
        echo "✅ aria2c started successfully and RPC is responding"
        break
    else
        if [ $i -eq $MAX_RETRIES ]; then
            echo "❌ Error: aria2c RPC test failed after $MAX_RETRIES attempts"
            cat /app/logs/aria2c.log
            exit 1
        fi
        echo "⚠️ RPC test failed, retrying in ${RETRY_DELAY} seconds..."
        sleep $RETRY_DELAY
    fi
done

# Start the Node.js app
echo "Starting Node.js application..."
exec node src/index.js
