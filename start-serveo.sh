#!/usr/bin/env bash
set -e

BACKEND_PORT=8000
TUNNEL_LOG="/tmp/aurora_tunnel"
rm -f "$TUNNEL_LOG"

TUNNEL_PID=""

cleanup() {
    echo ""
    echo "Stopping..."
    kill $TUNNEL_PID 2>/dev/null || true
    rm -f "$TUNNEL_LOG"
    # Restore original .env
    if [ -f "client/.env.backup" ]; then
        mv client/.env.backup client/.env
        echo "Restored client/.env"
    fi
    exit 0
}
trap cleanup INT TERM

# Step 1: start tunnel
echo "Starting tunnel (localhost:${BACKEND_PORT})..."
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -p 443 \
    -R "0:localhost:${BACKEND_PORT}" a.pinggy.io 2>&1 \
    | tee "$TUNNEL_LOG" &
TUNNEL_PID=$!

# Step 2: wait for URL
echo "Waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
    sleep 1
    TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.run\.pinggy-free\.link' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    [ -n "$TUNNEL_URL" ] && break
done

if [ -z "$TUNNEL_URL" ]; then
    echo "Failed to get tunnel URL. Output:"
    cat "$TUNNEL_LOG"
    cleanup
fi
echo "Tunnel: ${TUNNEL_URL}"

# Step 3: build React with tunnel URL
echo "Building React with tunnel URL..."
cp client/.env client/.env.backup 2>/dev/null || true
cat > client/.env << EOF
REACT_APP_API_URL=${TUNNEL_URL}/api
REACT_APP_WS_URL=${TUNNEL_URL/https/wss}
EOF

cd client
GENERATE_SOURCEMAP=false npm run build
cd ..

echo ""
echo "==========================================="
echo "  Aurora is ready!"
echo "  >>> Поделись: ${TUNNEL_URL} <<<"
echo "==========================================="
echo ""
echo "Restart your backend (python run.py) if not running."
echo "Press Ctrl+C to stop."

wait $TUNNEL_PID 2>/dev/null || true
