# Venue Adapter Interface Design

**Status:** Design sketch (not yet implemented)  
**Purpose:** Abstract venue-specific operations (Kuru CLOB vs Uniswap AMM) behind a common interface

## Current Architecture

The bot is currently hardcoded to **Monad + Kuru CLOB**:

```typescript
// src/market.ts
export class Market {
  readBook(): Promise<Book>;
  send(block, side, size, book, cancel, capped): Promise<Quote>;
  pollPending(block): Promise<QuoteResult[]>;
  // ... Kuru-specific: margin deposits, order cancellation, etc.
}

// src/trader.ts
export class Trader {
  constructor(private market: Market, ...) {}
  
  async onBlock(block: number) {
    const book = await this.market.readBook();
    const decision = await this.model.decide(...);
    const quote = await this.market.send(...);
    // ...
  }
}
```

## Proposed Venue Adapter Interface

```typescript
// src/venue.ts (new file)

export interface VenueAdapter {
  /** Chain and venue identification */
  readonly chainId: number;
  readonly venueName: string;
  readonly pair: string;
  
  /** Initialize: fetch params, setup wallet, etc. */
  init(): Promise<void>;
  
  /** Read current market data */
  readPrice(): Promise<PriceData>;
  
  /** Execute a trade (live mode only) */
  executeTrade?(side: Side, size: number, priceData: PriceData): Promise<TradeResult>;
  
  /** Check pending transactions (for async execution venues) */
  checkPending?(block: number): Promise<TradeUpdate[]>;
  
  /** Refresh venue state periodically */
  refresh?(): Promise<void>;
}

export interface PriceData {
  block: number;
  mid: number;
  bid: number;
  ask: number;
  spreadBps: number;
  
  // Optional: venue-specific data
  liquidity?: {
    bidDepth: number;
    askDepth: number;
  };
  
  // For CLOB: order book levels
  levels?: {
    bids: [number, number][];
    asks: [number, number][];
  };
}

export interface TradeResult {
  txHash: string | null;
  status: "pending" | "confirmed" | "failed" | "simulated";
  side: Side;
  price: number;
  size: number;
  gasCost?: number;
}

export interface TradeUpdate {
  block: number;
  txHash: string;
  status: "confirmed" | "failed";
  orderId?: number;
  executedPrice?: number;
  executedSize?: number;
}
```

## Implementation: Kuru Adapter

```typescript
// src/venues/kuru.ts (refactor existing Market class)

export class KuruAdapter implements VenueAdapter {
  readonly chainId = 143;
  readonly venueName = "Kuru";
  readonly pair = "MON-USDC";
  
  private market: Market; // existing Market class
  
  async init() {
    await this.market.init();
  }
  
  async readPrice(): Promise<PriceData> {
    const book = await this.market.readBook();
    return {
      block: book.block,
      mid: book.mid,
      bid: book.bid,
      ask: book.ask,
      spreadBps: book.spreadBps,
      liquidity: {
        bidDepth: book.depthBps["10"]?.bid ?? 0,
        askDepth: book.depthBps["10"]?.ask ?? 0,
      },
      levels: book.levels,
    };
  }
  
  async executeTrade(side: Side, size: number, priceData: PriceData): Promise<TradeResult> {
    const book = this.lastBook; // cached from readPrice
    const quote = await this.market.send(priceData.block, side, size, book, this.getRestingIds(), false);
    return {
      txHash: quote.txHash,
      status: quote.status === "sent" ? "pending" : quote.status === "placed" ? "confirmed" : "failed",
      side: quote.side,
      price: quote.price,
      size: quote.size,
      gasCost: quote.gasMon,
    };
  }
  
  async checkPending(block: number): Promise<TradeUpdate[]> {
    const results = await this.market.pollPending(block);
    return results.map(r => ({
      block: r.block,
      txHash: r.quote.txHash!,
      status: r.quote.status === "placed" ? "confirmed" : "failed",
      orderId: r.quote.orderId ?? undefined,
      executedPrice: r.quote.price,
      executedSize: r.quote.size,
    }));
  }
  
  async refresh() {
    await this.market.refresh();
  }
}
```

## Implementation: Uniswap/Arc Adapter (Sketch)

```typescript
// src/venues/uniswap-arc.ts (future implementation)

import { ethers } from "ethers";
import type { VenueAdapter, PriceData, TradeResult } from "../venue";

export class UniswapArcAdapter implements VenueAdapter {
  readonly chainId = 5042;
  readonly venueName = "Uniswap";
  readonly pair = "ETH-USDC";
  
  private provider: ethers.providers.Provider;
  private quoter: ethers.Contract; // Uniswap Quoter contract
  
  async init() {
    // Initialize provider, load Uniswap contracts
    this.provider = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl, config.chainId);
    // Load Quoter, Router, pool addresses
  }
  
  async readPrice(): Promise<PriceData> {
    const blockNumber = await this.provider.getBlockNumber();
    
    // Option 1: Use Uniswap Trading API
    // const response = await fetch(`https://api.uniswap.org/v2/quote?chainId=5042&tokenIn=ETH&tokenOut=USDC&amount=1000000000000000000`);
    
    // Option 2: Use on-chain quoter
    const amountIn = ethers.utils.parseEther("1"); // 1 ETH
    const buyQuote = await this.quoter.callStatic.quoteExactInputSingle({
      tokenIn: WETH_ADDRESS,
      tokenOut: USDC_ADDRESS,
      amountIn,
      fee: 3000, // 0.3% pool
      sqrtPriceLimitX96: 0,
    });
    
    const sellQuote = await this.quoter.callStatic.quoteExactOutputSingle({
      tokenIn: USDC_ADDRESS,
      tokenOut: WETH_ADDRESS,
      amount: amountIn,
      fee: 3000,
      sqrtPriceLimitX96: 0,
    });
    
    const buyPrice = Number(ethers.utils.formatUnits(buyQuote.amountOut, 6)); // USDC has 6 decimals
    const sellPrice = Number(ethers.utils.formatUnits(sellQuote.amountIn, 6));
    const mid = (buyPrice + sellPrice) / 2;
    
    return {
      block: blockNumber,
      mid,
      bid: sellPrice, // what you'd get selling ETH
      ask: buyPrice, // what you'd pay buying ETH
      spreadBps: ((buyPrice - sellPrice) / mid) * 10_000,
    };
  }
  
  async executeTrade(side: Side, size: number, priceData: PriceData): Promise<TradeResult> {
    // TODO: Implement swap via SwapRouter02 or UniversalRouter
    // - Convert size to Wei
    // - Set slippage tolerance
    // - Build and send swap transaction
    // - Return result
    
    throw new Error("Live Arc trading not yet implemented");
  }
  
  // checkPending and refresh are optional for AMMs (swaps are atomic)
}
```

## Migration Path

### Phase 1: Documentation (Current)
- ✅ Document venue differences (docs/ARC-VENUE.md)
- ✅ Design adapter interface (this file)

### Phase 2: Interface Extraction (Next)
- Extract `VenueAdapter` interface
- Wrap existing `Market` class as `KuruAdapter`
- Update `Trader` to use `VenueAdapter` interface
- Verify Monad path still works

### Phase 3: Arc Read-Only
- Implement `UniswapArcAdapter.readPrice()`
- Wire up Arc chain config
- Test dry-run with Arc prices

### Phase 4: Arc Live (Future, requires approval)
- Implement `UniswapArcAdapter.executeTrade()`
- Add Arc-specific P&L tracking
- Integration testing on Arc fork

## Testing Strategy

### Phase 2 (Monad regression)
```bash
CHAIN=monad DRY_RUN=true bun run start
# Should work exactly as before
```

### Phase 3 (Arc dry-run)
```bash
# Against live Arc
CHAIN=arc ALCHEMY_API_KEY=... DRY_RUN=true bun run start

# Against forked Arc
./scripts/fork-arc.sh
RPC_URL=http://127.0.0.1:8545 CHAIN=arc DRY_RUN=true bun run start
```

### Phase 4 (Arc live, with approval only)
```bash
CHAIN=arc ALCHEMY_API_KEY=... PRIVATE_KEY=... DRY_RUN=false bun run start
# NOT DEFAULT; requires Finance/Trade approval
```

## Key Design Decisions

1. **Interface-based:** Allows multiple venue implementations without changing `Trader` core logic
2. **Minimal:** Only abstracts what differs between venues (price data + trade execution)
3. **Optional methods:** `checkPending` and `refresh` only for async venues (CLOB)
4. **Preserves existing code:** Phase 2 wraps current `Market` class, no rewrite
5. **Dry-run compatible:** `executeTrade` is optional; dry-run works with just `readPrice`

## TypeSafe AI Integration

The bot uses **TypeSafe AI's Jev model** (System One) for buy/sell decisions. Jev sees market state and returns structured probabilities, not generated text. The decision layer is **venue-agnostic**: Jev doesn't need to know CLOB vs AMM mechanics.

### Current Flow

```typescript
// 1. Venue adapter reads market
const priceData = await venue.readPrice(); // Book (CLOB) or Quotes (AMM)

// 2. Build TradeState from venue data
const state: TradeState = buildState(priceData, history);

// 3. Jev decides buy/sell
const decision = await model.decide(state);
// Returns: { action: "buy"|"sell", probabilities: { buy, sell }, confidence }

// 4. Venue adapter executes (or simulates in dry-run)
if (!dryRun) {
  await venue.executeTrade(decision.action, size, priceData);
}
```

### Adapting for Arc (Uniswap)

**Key insight:** The venue adapter's job is to translate venue-specific data into `TradeState`. Jev's decision logic stays the same.

**Kuru adapter:**
- Input: CLOB book levels, taker flow from Trade logs
- TradeState: `bookImbalance`, `depth`, `book.bids/asks`, `trades.cvdMon`

**Uniswap adapter:**
- Input: Pool quotes (bid/ask), recent swap events
- TradeState: `spreadBps` (from quotes), `recentSwaps.cvdEth`, `poolLiquidity`
- Jev instructions: "Trade ETH-USDC on Uniswap... swap fees are 0.3%..."

**No model retraining needed**: Jev understands natural language state descriptions. Just adjust field names and instructions to match the new venue.

See [TYPESAFE-TRADING.md](TYPESAFE-TRADING.md) for detailed patterns.

## See Also

- [Arc Venue Research](ARC-VENUE.md) - Venue options (Uniswap, future Hibachi/Tangent CLOB)
- [TypeSafe Trading Patterns](TYPESAFE-TRADING.md) - How Jev makes decisions, adapting for Arc
- [README](../README.md) - Setup and usage
- `src/market.ts` - Current Kuru implementation
- `src/model.ts` - TypeSafe AI integration (Jev + mock model)
- `src/trader.ts` - Core trading loop
- `.agents/skills/typesafe-ai/SKILL.md` - TypeSafe skill documentation
