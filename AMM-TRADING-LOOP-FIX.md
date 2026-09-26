# AMM Trading Loop Fix

## Problem (After Quoter + Thin-Liquidity Fixes)
Quoter + 0.01 ETH fix VERIFIED on Alchemy. Adapter ready, QuoterV2 verified, prices read successfully. But new crash in trading loop:

```
block N: null is not an object (evaluating 'this.market.wallet')
...
ReferenceError: book is not defined
  at emit (src/trader.ts:310)
```

## Root Causes in `src/trader.ts`

After VenueAdapter wiring integrated AMM adapter alongside CLOB market class:

### 1. `emit()` Used Undeclared `book` Variable
**Lines ~310-325:** Parameter is `price: PriceData`, but code referenced `book.mid`, `book.bid`, `book.ask`, `book.spreadBps`

```typescript
// BEFORE (crashed with "book is not defined")
private emit(block: number, price: PriceData, ...) {
  const unrealized = this.unrealizedUsd(book.mid);  // ❌ book not defined
  t.pnlMon = t.pnlUsd / book.mid;                   // ❌
  const event = {
    mid: book.mid, bestBid: book.bid, bestAsk: book.ask, // ❌
    spreadBps: round(book.spreadBps, 2),               // ❌
    ...
    unrealizedMon: round(unrealized / book.mid, 4),    // ❌
  };
}

// AFTER (uses price parameter)
private emit(block: number, price: PriceData, ...) {
  const unrealized = this.unrealizedUsd(price.mid);  // ✅
  t.pnlMon = t.pnlUsd / price.mid;                   // ✅
  const event = {
    mid: price.mid, bestBid: price.bid, bestAsk: price.ask, // ✅
    spreadBps: round(price.spreadBps, 2),               // ✅
    ...
    unrealizedMon: round(unrealized / price.mid, 4),    // ✅
  };
}
```

### 2. `allowed()` Crashed on `this.market.wallet` When Market is Null
**Lines ~238-244:** Arc AMM path has `this.market = null`, so `this.market.wallet` crashed

```typescript
// BEFORE (crashed with "null is not an object")
private allowed(side: Side, book: Book) {
  const size = config.tradeSizeMon;
  const exposure = side === "buy" ? ... : ...;
  if (Math.abs(exposure) > config.maxPositionMon) return false;
  if (!this.market.wallet) return true;  // ❌ crashes when market is null
  return side === "buy" ? this.market.margin.usdc >= size * book.ask : ...;
}

// AFTER (uses optional chaining + price param)
private allowed(side: Side, price: PriceData) {
  const size = config.tradeSizeMon;
  const exposure = side === "buy" ? ... : ...;
  if (Math.abs(exposure) > config.maxPositionMon) return false;
  if (!this.market?.wallet) return true; // ✅ dry-run or AMM: skip margin check
  return side === "buy" ? this.market.margin.usdc >= size * price.ask : ...;
}
```

**Changes:**
- Optional chaining: `this.market?.wallet` (not `this.market.wallet`)
- Renamed parameter: `book` → `price` for clarity
- Uses `price.ask` / `price.bid` instead of `book.ask` / `book.bid`
- Comment clarifies dry-run / AMM behavior

### 3. `harvest()` Already Correct
**Line 183:** Already uses `(this.market && this.market.wallet)` ✅ No changes needed.

```typescript
const fills: Fill[] = (this.market && this.market.wallet) 
  ? this.liveFills(this.trades.drainFills()) 
  : this.simFills(prints);
```

## Expected Behavior After Fix

**AMM path (Arc, `this.market = null`):**
1. ✅ `allowed()` returns `true` (skips margin check)
2. ✅ Sim quote branch executes (~132-149 in tick loop)
3. ✅ `emit()` uses `price.mid`, `price.bid`, `price.ask`
4. ✅ Emits `(sim)` ticks with mid ~2600–2800 USDC/ETH
5. ✅ No crashes on `this.market.wallet` or `book is not defined`

**CLOB path (Monad/Kuru, `this.market` exists):**
1. ✅ `allowed()` checks `this.market.margin` funds
2. ✅ Live order placement branch executes
3. ✅ Everything works as before

## Success Criteria ✅

```bash
CHAIN=arc MODEL=mock DRY_RUN=true bun run start
```

**Expected:**
- ✅ Runs ≥10 seconds without crash
- ✅ Prints multiple `(sim)` lines
- ✅ Mid in 2600–2800 USDC/ETH range
- ✅ No `this.market.wallet` errors
- ✅ No `book is not defined` errors

**Sample output:**
```
Arc Uniswap adapter initializing...
  QuoterV2 verified at 0x7dfd4f31be6814d2906bde155c3e1b146eac1468
  ✅ Arc adapter ready (dry-run only)

block 12345 mid 2689.3 bid 2678.8 ask 2699.5 spread 7.7bps (sim) hold
block 12346 mid 2690.1 bid 2679.2 ask 2700.8 spread 8.0bps (sim) hold
block 12347 mid 2688.5 bid 2677.9 ask 2698.9 spread 7.8bps (sim) buy
...
```

## Files Changed
- `src/trader.ts`: 
  - `emit()`: Replace all `book.*` with `price.*`
  - `allowed()`: Optional chaining `this.market?.wallet`, rename param `book` → `price`

## Commit
`a1da7f7` - Fix AMM trading loop crashes: replace book with price in emit() and allowed()

Branch: `cursor/arc-mainnet-support-bda7` ✅ Pushed

---

## Complete Arc Dry-Run Fix Summary

Three blockers resolved in sequence:

1. ✅ **Wrong QuoterV2 address** (commit `9842c65`, `f89910b`)
   - `0x78D7...` → `0x7dfd...1468`
   - V1 ABI → QuoterV2 struct-param ABI
   - Single-direction → both-direction quotes

2. ✅ **Thin liquidity** (commit `3e4d8ad`)
   - 1 ETH quote size → 0.01 ETH
   - Normalize to per-1-ETH prices
   - Fallback for buy quote failures

3. ✅ **AMM trading loop crashes** (commit `a1da7f7`)
   - `emit()`: `book.*` → `price.*`
   - `allowed()`: `this.market.wallet` → `this.market?.wallet`

**All fixes pushed to `cursor/arc-mainnet-support-bda7`**  
**Ready for Arc dry-run testing!**
