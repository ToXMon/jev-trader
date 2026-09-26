#!/usr/bin/env bash
set -euo pipefail

# Fork Circle Arc mainnet locally with Foundry anvil
# Requires: foundry (https://book.getfoundry.sh/getting-started/installation)
# Usage: ./scripts/fork-arc.sh [port]

PORT="${1:-8545}"
ALCHEMY_KEY="${ALCHEMY_API_KEY:-}"

if [ -z "$ALCHEMY_KEY" ]; then
  echo "Error: ALCHEMY_API_KEY not set"
  echo "Usage: ALCHEMY_API_KEY=your-key ./scripts/fork-arc.sh [port]"
  echo "   or: export ALCHEMY_API_KEY=your-key in .env"
  exit 1
fi

FORK_URL="https://arc-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}"
CHAIN_ID=5042

echo "Forking Arc mainnet (chainId $CHAIN_ID) at port $PORT..."
echo "Fork URL: ${FORK_URL%%/*}/***"
echo ""
echo "Connect to fork:"
echo "  RPC_URL=http://127.0.0.1:$PORT READ_RPC_URL=http://127.0.0.1:$PORT CHAIN=arc bun run start"
echo ""

anvil \
  --fork-url "$FORK_URL" \
  --port "$PORT" \
  --chain-id "$CHAIN_ID" \
  --silent
