# Arc Quoter Blocker Fix - Complete

## Problem Summary
**Blocker**: Mock dry-run booted but every block failed with `CALL_EXCEPTION` on Quoter.

**Root Cause** (verified on-chain):
- Wrong Quoter address `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` had **code length 0** on Arc
- Was using V1 ABI (5-arg flat params) instead of QuoterV2 (struct params)
- Only quoted one direction, approximated spread instead of querying both ways

## Fix Applied ✅

### 1. Correct QuoterV2 Address
```diff
- Quoter: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077", // WRONG: no code on Arc
+ QuoterV2: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468", // ✅ Has code, verified on-chain
```

### 2. Updated SwapRouter02 Address
```diff
- SwapRouter02: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
+ SwapRouter02: "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77", // ✅ From ARC_ADDRESSES block
```

### 3. QuoterV2 Struct-Param ABI
```typescript
// OLD (V1 - flat params):
"function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)"

// NEW (V2 - struct param):
"function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96))"
"function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96))"
```

### 4. Both-Direction Quotes for Real Bid/Ask
```typescript
// OLD: Single direction + approximated spread
const sellPrice = await quoter.quoteExactInputSingle(WETH, USDC, ...);
const bid = sellPrice * (1 - poolFeeFactor / 2);
const ask = sellPrice * (1 + poolFeeFactor / 2);

// NEW: Query both directions
const sellResult = await quoterV2.quoteExactInputSingle({
  tokenIn: WETH, tokenOut: USDC, amountIn: 1e18, fee: 3000, sqrtPriceLimitX96: 0
});
const bid = sellResult.amountOut; // What you GET selling ETH

const buyResult = await quoterV2.quoteExactOutputSingle({
  tokenIn: USDC, tokenOut: WETH, amount: 1e18, fee: 3000, sqrtPriceLimitX96: 0
});
const ask = buyResult.amountIn; // What you PAY buying ETH

const mid = (bid + ask) / 2;
const spreadBps = ((ask - bid) / mid) * 10_000;
```

### 5. Fee Tier 3000 Verified
- Fee 500: reverts (pool doesn't exist)
- Fee 3000: ✅ works, pool `0x964cFF2cCCB9059e83D507df348f070e5257A2e0` has liquidity
- Fee 10000: returns tiny value (~19)

### 6. On-Chain Verification Added
```typescript
// New in init(): verify QuoterV2 has code
const quoterCode = await this.provider.getCode(ADDRESSES.QuoterV2);
if (quoterCode === "0x" || quoterCode === "0x0") {
  throw new Error(`QuoterV2 at ${ADDRESSES.QuoterV2} has no code on Arc`);
}
console.log(`QuoterV2 verified at ${ADDRESSES.QuoterV2}`);
```

## Verified On-Chain (2026-09-26)
✅ QuoterV2 `0x7dfd4f31be6814d2906bde155c3e1b146eac1468` has code  
✅ Pool mid ≈ **2689 USDC/ETH** (from slot0)  
✅ Quote size: **0.01 ETH** (1 ETH quotes fail/skew due to thin liquidity)  
✅ 0.01 ETH quotes: IN ~2678.8, OUT ~2699.5 USDC/ETH  
✅ WETH 18 decimals, USDC 6 decimals  
✅ WETH-USDC 0.3% pool exists at `0x964cFF2cCCB9059e83D507df348f070e5257A2e0`

## Documentation Updated
- ✅ `ARC-DRY-RUN-GUIDE.md`: Address table with status column
- ✅ `docs/ARC-VENUE.md`: Updated addresses + how-it-works section

## Success Criteria (Ready to Test)
```bash
CHAIN=arc ALCHEMY_API_KEY=... MODEL=mock DRY_RUN=true bun run start
```

**Expected Output:**
1. ✅ `Arc adapter ready (dry-run only)` on boot
2. ✅ `QuoterV2 verified at 0x7dfd4f31be6814d2906bde155c3e1b146eac1468`
3. ✅ `(sim)` ticks with **real mid ~2600–2800** USDC/ETH (not Quoter revert spam)
4. ✅ Bid/ask spread from actual two-way quotes (0.01 ETH notional, normalized)

**NOT Expected:**
❌ `CALL_EXCEPTION` errors  
❌ `execution reverted` on Quoter  
❌ Zero prices or ~944 USDC/ETH (that was 1 ETH slippage artifact)  
❌ `QuoterV2 call failed` spam

## Source
All addresses from **Uniswap SDK `ARC_ADDRESSES`** block:  
`github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts`

## Files Changed
- `src/venues/uniswap-arc.ts`: QuoterV2 address, ABI, both-direction quotes
- `ARC-DRY-RUN-GUIDE.md`: Address table update
- `docs/ARC-VENUE.md`: Address + how-it-works update

## Commits
1. `9842c65` - Fix Arc Quoter blocker: use correct QuoterV2 address + docs updates
2. `f89910b` - Complete QuoterV2 fix: both-direction quotes in readPrice()

Branch: `cursor/arc-mainnet-support-bda7` ✅ Pushed
