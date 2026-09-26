# Arc Dry-Run Guide

This guide shows how to run the jev-trader bot in dry-run mode on Arc mainnet.

## Prerequisites

1. **Alchemy API key** for Arc mainnet
2. **Bun** installed (`curl -fsSL https://bun.sh/install | bash`)

## Setup

### 1. Configure Environment

Create or update `.env`:

```bash
# Chain selection
CHAIN=arc

# Alchemy RPC for Arc mainnet (chainId 5042)
ALCHEMY_API_KEY=your-alchemy-api-key-here

# Safety: Dry-run mode (no real trades)
DRY_RUN=true
PRIVATE_KEY=
# (leave PRIVATE_KEY unset for dry-run)

# Model selection
MODEL=mock
# (use mock for deterministic decisions, or jev with TYPESAFE_AI_API_KEY)

# Trading parameters (same as Monad defaults)
TRADE_SIZE_MON=200
MAX_POSITION_MON=1000
BANKROLL_USD=100
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Run Arc Dry-Run

```bash
bun run start
```

## What to Expect

### Successful Startup

You should see output like this:

```
Creating Arc Uniswap adapter (chainId 5042)

Arc Uniswap adapter initializing...
  Chain ID: 5042
  RPC: https://arc-mainnet.g.alchemy.com/v2/***
  Pair: ETH-USDC
  Tokens verified: WETH (18 dec), USDC (6 dec)
  ✅ Arc adapter ready (dry-run only)

jev-trader · chain=Uniswap V3 (5042) · pair=ETH-USDC · model=mock · post-only 1 tick inside the touch · horizon 100 blocks · DRY RUN · market 0x065C9d28E428A0db40191a54d33d5b7c71a9C394 · read https://arc-mainnet.g.alchemy.com/v2/*** · :3000

#12345 2050.500000 b77 s23 80ms BUY 200 @ 2050.123456 (sim) pnl $0 · read 45ms loop 125ms
#12346 2050.750000 b65 s35 82ms SELL 200 @ 2050.250000 (sim) pnl $0 · read 42ms loop 118ms
...
```

### Key Indicators

- ✅ **Adapter**: `Uniswap V3 (5042)` - confirms Arc
- ✅ **Pair**: `ETH-USDC` - correct pair
- ✅ **DRY RUN** - no real trades
- ✅ **Prices**: Mid price from Arc Uniswap pool
- ✅ **Decisions**: `b77 s23` = model probabilities (buy 77%, sell 23%)
- ✅ **(sim)**: Simulated orders, not real

### Block Events

Each line shows:
```
#<block> <mid-price> b<buy%> s<sell%> <latency>ms <BUY|SELL> <size> @ <price> (sim) pnl $<pnl>
```

Example:
```
#12345 2050.500000 b77 s23 80ms BUY 200 @ 2050.123456 (sim) pnl $0.15 · read 45ms loop 125ms
```

- Block #12345
- Mid price: 2050.50 USDC per ETH
- Model: 77% buy, 23% sell
- Decision: BUY 200 ETH at 2050.123456
- Status: (sim) = simulated, no real tx
- P&L: $0.15 cumulative
- Timing: 45ms to read price, 125ms total loop

## Testing Arc Fork Locally

You can test against a local fork without mainnet RPC limits:

### 1. Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 2. Start Fork

In one terminal:
```bash
ALCHEMY_API_KEY=your-key ./scripts/fork-arc.sh
# Forks Arc mainnet at http://127.0.0.1:8545
```

### 3. Run Against Fork

In another terminal:
```bash
RPC_URL=http://127.0.0.1:8545 \
READ_RPC_URL=http://127.0.0.1:8545 \
CHAIN=arc \
MODEL=mock \
DRY_RUN=true \
bun run start
```

## Troubleshooting

### "Arc Uniswap adapter requires verified contract addresses"

This error appears if the adapter's addresses are still placeholders. The addresses in `src/venues/uniswap-arc.ts` are **verified as of 2026-09-26**. If you see this error, addresses may need re-verification.

### "Uniswap pool may not exist for WETH-USDC on Arc"

This means the Uniswap pool either:
1. Doesn't exist on Arc
2. Has no liquidity
3. RPC connection issue

Verify the pool exists on Arc block explorer.

### "UNPREDICTABLE_GAS_LIMIT"

This is an ethers.js error when a call would revert. Usually means:
- Pool doesn't exist
- Insufficient liquidity
- Wrong token addresses

### No Blocks Coming Through

Check:
1. `ALCHEMY_API_KEY` is set correctly
2. RPC URL is reachable: `curl https://arc-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
3. Chain ID matches: should return `0x13b2` (5042 in hex)

## What's NOT Implemented Yet

❌ **Live Arc trading** - No swap execution. The bot only reads prices and simulates decisions.

❌ **Fill detection** - No Arc swap event monitoring. Fills are simulated against the decision price.

❌ **Trade feed** - No Arc-specific trade log polling. `trades` in state will show zeros.

❌ **Gas tracking** - Arc uses USDC for gas. Gas cost tracking not yet implemented for Arc.

## Verified Contract Addresses

These addresses are verified on Arc mainnet (chainId 5042):

| Contract | Address | Source |
|----------|---------|--------|
| WETH (bridged) | `0x128cC466B61f542da60c70e3aA11c10e19B84EDB` | Aave Arc assessment |
| USDC (6 decimals) | `0x3600000000000000000000000000000000000000` | Circle Arc docs |
| Uniswap V3 Factory | `0xf0db7b58379503491d857db50ac9ece64c653918` | Uniswap SDK |
| SwapRouter02 | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | Uniswap SDK |
| Quoter | `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` | Uniswap SDK |

**Verified**: 2026-09-26  
**Sources**: 
- github.com/Uniswap/sdks (sdk-core/src/addresses.ts)
- github.com/Uniswap/UniswapX (playbook/chains/arc.md)
- github.com/Uniswap/v3-subgraph (PR #300)
- ethskills addresses (austintgriffith/ethskills)

## Next Steps

Once Arc dry-run is working:

1. **Adjust TradeState for Jev** - Update TypeSafe questions to handle missing CLOB fields
2. **Implement swap execution** - Add live Arc trading (requires approval)
3. **Add swap event monitoring** - Track real fills from Arc swaps
4. **USDC gas tracking** - Arc-specific gas cost accounting

## Resources

- **Arc docs**: docs.arc.io
- **Uniswap SDK**: github.com/Uniswap/sdks
- **ethskills**: ethskills.com (contract addresses, security)
- **TypeSafe AI**: docs.typesafe.ai (Jev model patterns)
