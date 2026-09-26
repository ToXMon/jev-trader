# Arc Mainnet Trading Venues

**Research date:** 2026-09-26  
**Chain:** Circle Arc mainnet (chainId **5042**, 0x13b2)  
**Target pair:** ETH-USDC or WETH-USDC

## Overview

Circle Arc is a mainnet L1 launched September 2026 with **USDC as native gas**. Unlike Monad's Kuru CLOB (Central Limit Order Book), Arc's DeFi ecosystem is built around AMM (Automated Market Maker) protocols.

## Available Venues

### 1. Uniswap v3/v4 (Recommended)

**Status:** Live on Arc mainnet  
**Type:** Concentrated liquidity AMM  
**Pair:** ETH-USDC pools available

**Resources:**
- Uniswap Trading API: `https://api.uniswap.org/v2/quote` (supports `chainId=5042`)
- Uniswap v4 pools are indexed on Arc (per Uniswap blog 2026-09-16)
- SDK: `@uniswap/v3-sdk` or `@uniswap/v4-sdk`

**Key differences from Kuru CLOB:**
- **No post-only maker orders**: AMM swaps are atomic taker actions
- **No order book**: Pricing from concentrated liquidity curve
- **Spread capture**: Not applicable; instead pay swap fees to LPs
- **Quote mechanism**: Use Uniswap Trading API or simulate swaps via quoter contracts

**Integration approach:**
1. Query mid price from Uniswap pools or API
2. Model decides buy/sell from price feed (same as Monad)
3. Execute via swap router instead of limit orders
4. Track fills via swap events, not maker order fills

### 2. Uniswap X (Alternative)

**Status:** Available on Arc  
**Type:** Dutch auction intents / aggregator

**Considerations:**
- More complex integration (off-chain matching)
- Better execution for larger sizes
- Adds latency vs direct swaps

### 3. Other AMMs

Arc may support other AMM protocols (Curve, Balancer-style), but Uniswap is the reference implementation and most liquid.

## CLOB Availability

### Current Status: No Live CLOB

**No production CLOB equivalent to Kuru found on Arc at this time.** Arc's DeFi infrastructure appears AMM-focused as of the mainnet launch.

### Future CLOB Options

Two on-chain order book protocols have been mentioned in Arc context:

#### Hibachi
- **Status:** Development/testnet stage (not confirmed on Arc mainnet yet)
- **Type:** On-chain order book DEX
- If deployed on Arc, would provide CLOB functionality similar to Kuru

#### Tangent
- **Status:** Development stage (Arc deployment not confirmed)
- **Type:** On-chain order book protocol
- Could provide maker/taker order flow on Arc in the future

**Action:** Monitor Arc DeFi ecosystem for Hibachi or Tangent mainnet deployments. If either launches, this bot's Kuru adapter pattern (post-only maker orders, order cancellation, margin accounts) would be directly applicable with contract address updates.

Until then, **Uniswap AMM** is the recommended venue for Arc ETH-USDC trading.

## Implementation Strategy

### Phase 1: Read-Only Price Feed (Dry-Run) ✅ **IMPLEMENTED**

**Status**: Working Arc Uniswap adapter with verified addresses!

See `src/venues/uniswap-arc.ts` for implementation.

**Verified contract addresses** (sources: Uniswap SDK, ethskills, Uniswap v3-subgraph PR):
- WETH (bridged): `0x128cC466B61f542da60c70e3aA11c10e19B84EDB`
- USDC (6 decimals): `0x3600000000000000000000000000000000000000`
- Uniswap V3 Factory: `0xf0db7b58379503491d857db50ac9ece64c653918`
- SwapRouter02: `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`
- Quoter: `0x78D78E420Da98ad378D7799bE8f4AF69033EB077`

**How it works:**
1. Uses Uniswap V3 Quoter `callStatic.quoteExactInputSingle` for WETH-USDC
2. Queries: "Sell 1 WETH, how much USDC?"
3. Bid/ask calculated from pool fee (0.3% = 30 bps spread)
4. Returns `PriceData` with mid, bid, ask, spreadBps

**Dry-run behavior:**
- Model sees real Arc Uniswap prices
- Decisions logged
- No swaps executed (same as current Monad dry-run)
- Next: Wire into trading loop for end-to-end test

### Phase 2: Live Execution (Future, requires approval)

Extend adapter:

```typescript
interface VenueAdapter {
  readPrice(): Promise<{ mid: number; bid: number; ask: number }>;
  executeSwap(side: "buy" | "sell", amount: number): Promise<SwapResult>;
}
```

**For Uniswap on Arc:**
1. Use `SwapRouter02` or `UniversalRouter`
2. Set slippage tolerance
3. Monitor swap events for fills

**Critical differences from Kuru:**
- Gas paid in USDC (not native token)
- No margin account deposits
- No order cancellation (swaps are atomic)
- P&L tracking changes (no resting orders)

## Contract Addresses

**Note:** Specific Uniswap v3/v4 pool addresses for ETH-USDC on Arc should be verified at integration time. Use:
- Uniswap Info / Analytics sites
- Arc block explorers
- Uniswap SDK's `getPool()` methods

Example verification:
```bash
# Query Uniswap v3 factory for ETH-USDC pool on Arc
cast call <FACTORY_ADDRESS> \
  "getPool(address,address,uint24)" \
  <WETH_ADDRESS> <USDC_ADDRESS> 3000 \
  --rpc-url https://arc-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}
```

## Next Steps

1. ✅ Document venue landscape (this file)
2. ⬜ Implement `VenueAdapter` interface
3. ⬜ Add Monad/Kuru adapter (existing code refactored)
4. ⬜ Add Arc/Uniswap adapter (read-only price feed)
5. ⬜ Test dry-run with Arc prices
6. ⬜ (Later, with approval) Implement Arc swap execution

## References

- Circle Arc docs: Research brief mentions Arc launch 2026-09-16
- Uniswap on Arc: v4 pools confirmed in research brief
- Kuru vs AMM microstructure: Research brief section 2
- Gas in USDC: Arc native gas token is USDC per research brief

---

**For live trading on Arc:** Finance/Chief approval required before funding any wallet or executing swaps.
