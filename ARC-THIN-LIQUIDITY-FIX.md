# Arc Thin Liquidity Fix

## Problem (Post-QuoterV2 Address Fix)
After fixing QuoterV2 address to `0x7dfd4f31be6814d2906bde155c3e1b146eac1468`, still blocked:

**With 1 ETH quote size:**
- `quoteExactInputSingle(WETH→USDC, 1 ETH)` → ~944 USDC (badly skewed)
- `quoteExactOutputSingle(want 1 ETH out)` → **reverts "Unexpected error"**
- Pool can't fill 1 ETH orders (thin liquidity)

**Actual pool mid:** ~2689 USDC/ETH (from slot0)

## Root Cause
WETH-USDC 0.3% pool `0x964cFF2cCCB9059e83D507df348f070e5257A2e0` has limited depth:
- Small quotes (0.01 ETH, 0.001 ETH) work and match slot0
- Large quotes (1 ETH) hit slippage walls or revert

## Solution ✅
Quote with **0.01 ETH notional**, normalize to per-1-ETH prices.

### Code Changes

```typescript
// OLD (1 ETH quote)
const oneEth = ethers.utils.parseUnits("1", this.wethDecimals);
const sellResult = await quoterV2.quoteExactInputSingle({
  amountIn: oneEth,  // 1 ETH
  ...
});
const bid = Number(formatUnits(sellResult.amountOut, 6)); // ~944 (wrong!)

// NEW (0.01 ETH quote + normalization)
const quoteEth = ethers.utils.parseUnits("0.01", this.wethDecimals);
const quoteSize = 0.01;

const sellResult = await quoterV2.quoteExactInputSingle({
  amountIn: quoteEth,  // 0.01 ETH
  ...
});
const sellUsdcOut = Number(formatUnits(sellResult.amountOut, 6)); // ~26.78 USDC
const bid = sellUsdcOut / quoteSize; // ~2678 USDC/ETH ✅

const buyResult = await quoterV2.quoteExactOutputSingle({
  amount: quoteEth,  // want 0.01 ETH out
  ...
});
const buyUsdcIn = Number(formatUnits(buyResult.amountIn, 6)); // ~26.99 USDC
const ask = buyUsdcIn / quoteSize; // ~2699 USDC/ETH ✅

const mid = (bid + ask) / 2; // ~2689 USDC/ETH ✅
```

### Fallback for Buy Quote
If `quoteExactOutputSingle` fails (very thin liquidity), synthesize ask:
```typescript
try {
  buyResult = await quoterV2.quoteExactOutputSingle({...});
} catch (outputErr) {
  // Fallback: sell price + 0.3% pool fee
  buyUsdcIn = sellUsdcOut * (1 + 0.003);
  console.warn(`Using synthetic ask. Error: ${outputErr.message}`);
}
```

## Verified Results (0.01 ETH quotes on Arc mainnet)

| Quote Size | Direction | Result | Per-1-ETH Price |
|------------|-----------|--------|-----------------|
| 0.01 ETH | Sell (IN) | ~26.78 USDC out | ~2678.8 USDC/ETH |
| 0.01 ETH | Buy (OUT) | ~26.99 USDC in | ~2699.5 USDC/ETH |
| 0.001 ETH | Sell (IN) | ~2.68 USDC out | ~2680.8 USDC/ETH |
| 0.001 ETH | Buy (OUT) | ~2.70 USDC in | ~2697.5 USDC/ETH |

**Pool slot0 mid:** ≈ **2689 USDC/ETH** ✅

## Success Criteria ✅

```bash
CHAIN=arc ALCHEMY_API_KEY=... MODEL=mock DRY_RUN=true bun run start
```

**Expected:**
- ✅ `Arc adapter ready (dry-run only)` on boot
- ✅ `QuoterV2 verified at 0x7dfd4f31be6814d2906bde155c3e1b146eac1468`
- ✅ `(sim)` ticks with **mid ~2600–2800** USDC/ETH
- ✅ No `QuoterV2 call failed` spam
- ✅ No reverts on price reads

**NOT expected:**
- ❌ Mid ~944 USDC/ETH (that was 1 ETH slippage artifact)
- ❌ `CALL_EXCEPTION` or `execution reverted`
- ❌ `Unexpected error` from output quotes

## Files Changed
- `src/venues/uniswap-arc.ts`: 0.01 ETH quote size, normalization, fallback
- `ARC-DRY-RUN-GUIDE.md`: Expected mid ~2600-2800, note on thin liquidity
- `docs/ARC-VENUE.md`: 0.01 ETH notional flow, pool mid ~2689
- `QUOTER-FIX-SUMMARY.md`: Updated verified results

## Commit
`3e4d8ad` - Fix Arc thin-liquidity blocker: use 0.01 ETH quote size

Branch: `cursor/arc-mainnet-support-bda7` ✅ Pushed
