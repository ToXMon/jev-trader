# TypeSafe AI for Arc Trading Decisions

**Skill:** `.agents/skills/typesafe-ai`  
**Docs:** https://docs.typesafe.ai/llms.txt  
**Current model:** Jev (TypeSafe's System One flagship)

## Overview

The bot uses **TypeSafe AI's Jev model** to make buy/sell decisions from market state. Jev is a **System One model**: it returns fast, structured decisions with calibrated probabilities rather than generating text or reasoning chains. Code stays in control; Jev supplies programmable common sense where semantic understanding of market conditions helps.

## Current Implementation (Monad/Kuru)

See `src/model.ts` for the existing integration:

```typescript
// Decision: buy or sell (hold only appears on late blocks)
type Action = "buy" | "sell" | "hold";

// What Jev sees: market state in compact, human-readable form
interface TradeState {
  market: "MON-USDC";
  mid: number;
  spreadBps: number;
  bookImbalance: number; // -1 (all asks) .. 1 (all bids)
  depth: { [band: string]: { bid: number; ask: number } };
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1, last5, last20, last100 };
  recentMids: string;
  trades: { count, buyMon, sellMon, cvdMon, vwap, lastPrice, lastSide };
  recentTrades: string[];
  allowed: { buy: boolean; sell: boolean };
}

// One Choice question via AI SDK's experimental_evaluate
const QUESTIONS = {
  direction: {
    type: "choice",
    instructions: {
      question: "Will MON be higher or lower than the current mid after `horizonBlocks` more blocks?",
      goal: "Trade MON-USDC on Kuru. Blocks are ~300ms...",
      timing: "The order executes as an immediate-or-cancel market order in the next block.",
      inputs: "Taker flow is the strongest signal: `trades.cvdMon`...",
    },
    criteria: {
      buy: "Buy MON now: mid more likely to be higher...",
      sell: "Sell MON now: mid more likely to be lower...",
    },
  },
};
```

**Result:** Jev returns `{ choice: "buy"|"sell", probabilities: { buy, sell }, confidence }`. The bot posts a post-only limit order on that side.

## Adapting for Arc (Uniswap AMM)

Arc's Uniswap venue differs from Kuru CLOB in execution but **not in the decision problem**: Jev still decides buy/sell from market state; only the execution layer changes.

### Key Differences

| Aspect | Kuru (Monad) | Uniswap (Arc) |
|--------|--------------|---------------|
| **Venue type** | CLOB (order book) | AMM (liquidity pool) |
| **Decision input** | Book levels, taker flow, spreads | Pool reserves, swap fees, volume |
| **Execution** | Post-only maker order | Atomic swap (taker) |
| **Spread capture** | Earn spread (maker rebate) | Pay swap fees to LPs |
| **Jev's role** | **Same**: decide buy/sell from state | **Same**: decide buy/sell from state |

### Recommended Approach: Keep Single Choice Question

**For Arc dry-run and initial live trading**, the existing `direction` Choice question works with minor adjustments:

```typescript
// Updated TradeState for Arc
interface TradeState {
  market: "ETH-USDC";  // was "MON-USDC"
  venue: "Uniswap v3" | "Uniswap v4";  // add venue context
  mid: number;
  spreadBps: number;  // from pool quotes (bid/ask from quoter)
  // Remove CLOB-specific fields: bookImbalance, depth, book levels
  // Add AMM-specific context:
  poolLiquidity?: { totalUsd: number };
  recentSwaps?: { count, buyEth, sellEth, cvdEth, vwap };  // on-chain swap events
  returnsBps: { last1, last5, last20, last100 };
  recentMids: string;
  allowed: { buy: boolean; sell: boolean };
}

// Adjust instructions for AMM venue
const ARC_QUESTIONS = {
  direction: {
    type: "choice",
    instructions: {
      question: "Will ETH be higher or lower than the current mid after `horizonBlocks` blocks?",
      goal: "Trade ETH-USDC on Uniswap (Arc mainnet). Blocks are ~300ms. The swap pays fees to LPs (~0.3%), so the move must beat that cost.",
      timing: "The swap executes atomically in the next block.",
      inputs: "Recent on-chain swaps show taker flow: `recentSwaps.cvdEth` (buy volume - sell volume). `spreadBps` is the current bid/ask from the Uniswap quoter. `returnsBps` and `recentMids` show price history.",
    },
    criteria: {
      buy: "Buy ETH now: mid more likely to be higher after `horizonBlocks` blocks, by more than swap fees.",
      sell: "Sell ETH now: mid more likely to be lower after `horizonBlocks` blocks, by more than swap fees.",
    },
  },
};
```

**Rationale:**
- Jev's buy/sell decision doesn't need to know CLOB vs AMM mechanics
- The model sees **directional intent** (will price move up or down)
- Code handles venue-specific execution (limit order vs swap)
- Same confidence and probability handling

## Advanced: Multi-Question Patterns (Future)

Once Arc trading is stable, consider **TypeSafe patterns** for richer decisions:

### Pattern 1: Composite Scoring

Break the decision into atomic judgments, combine in code:

```typescript
const COMPOSITE_QUESTIONS = {
  momentum: {
    type: "score",
    instructions: "Rate ETH momentum over the horizon",
    criteria: ["strong down", "down", "neutral", "up", "strong up"],
  },
  volume_conviction: {
    type: "score",
    instructions: "How strong is the taker flow signal?",
    criteria: ["very weak", "weak", "moderate", "strong", "very strong"],
  },
  liquidity_risk: {
    type: "noul",
    instructions: "Is liquidity too thin to trade this size safely?",
  },
};

// Code combines scores with weights, thresholds
const momentumScore = answers.momentum.score; // 0..4
const volumeScore = answers.volume_conviction.score;
const signal = (momentumScore - 2) * 0.6 + (volumeScore - 2) * 0.4;
if (answers.liquidity_risk.probability > 0.7) return "hold"; // too risky
return signal > 0.3 ? "buy" : signal < -0.3 ? "sell" : "hold";
```

**Benefits:**
- Separately tune weights without re-running inference
- Inspect which dimension drove each decision
- Use scores as features for ML later

### Pattern 2: Confidence-Gated Sizing

Vary trade size based on Jev's confidence:

```typescript
const decision = await jev.decide(state);
if (decision.confidence < 0.3) {
  return { action: "hold", reason: "low confidence" };
}
const baseSize = config.tradeSizeEth;
const sizeMultiplier = decision.confidence; // 0.3..1.0
const adjustedSize = baseSize * sizeMultiplier;
return { action: decision.action, size: adjustedSize };
```

### Pattern 3: Speculative Fan-Out

Ask multiple questions in one call:

```typescript
const SPECULATIVE_QUESTIONS = {
  direction: { type: "choice", ... }, // main decision
  // Speculative: only used if we go that direction
  buy_aggressive: {
    type: "noul",
    instructions: "If buying, should we market buy immediately vs limit?",
  },
  sell_aggressive: {
    type: "noul",
    instructions: "If selling, should we market sell immediately vs limit?",
  },
};

// Code consumes relevant answers only
if (decision.action === "buy" && answers.buy_aggressive.probability > 0.7) {
  return { action: "market_buy", slippage: 0.01 };
} else if (decision.action === "buy") {
  return { action: "limit_buy", price: mid * 0.998 };
}
```

## TypeSafe Best Practices for Trading Bots

### 1. State Design
- **Keep it compact and human-readable**: Jev reads JSON field names
- **Use descriptive units**: "spreadBps" not "spread", "last20" not "r20"
- **Include relative context**: "returnsBps.last20" beats raw price history
- **Backtick paths** in instructions: reference `trades.cvdMon` or `recentMids`

### 2. Question Design
- **One coherent judgment per question**: "Will price go up?" not "Analyze the market"
- **Define complete criteria**: "buy" and "sell" both need clear definitions
- **State the goal explicitly**: "Trade ETH-USDC... fees are 0.3%..."
- **Reference the strategy**: "The swap pays fees..." helps calibrate thresholds

### 3. Probability Usage
- **Thresholds on data**: Don't hardcode `> 0.6` without measuring on your data
- **Confidence != permission**: Low confidence doesn't mean wrong, just spread out
- **Choice confidence** is about distribution concentration, not outcome certainty
- **For Noul**, `p ≈ 0.5` means "unsure", not "medium intensity"

### 4. Dry-Run First
- **Simulate fills** from decisions: see what real P&L would have been
- **Log all state + answers**: CSV or JSONL for later analysis
- **Compare vs baseline**: does Jev beat mock model? buy-and-hold?
- **Measure on representative periods**: include low volume, high volatility, trending

### 5. Error Handling
- **Separate failure types**: missing data, Jev API error, execution failure
- **Default to safe**: if Jev call fails, hold or use fallback model
- **Log inputs that fail**: specific state that broke vs generic network error
- **Retry transient errors**: TypeSafe SDK has built-in retry policy

## Integration Checklist for Arc Adapter

- [ ] Update `TradeState` interface for Arc venue context
- [ ] Remove CLOB-specific fields (book levels, depth per band)
- [ ] Add AMM-specific fields (pool liquidity, recent swaps)
- [ ] Adjust `QUESTIONS.direction.instructions` for Uniswap semantics
- [ ] Update criteria to reference swap fees instead of spread capture
- [ ] Test with Arc fork: verify state construction from Uniswap data
- [ ] Dry-run: log Jev decisions + simulated fills for X blocks
- [ ] Compare Jev vs mock model P&L on same Arc data
- [ ] (Later) Implement confidence-gated sizing or composite scoring

## Cost & Latency Budget

**Current (Monad):**
- Jev latency: ~80-200ms per decision (fits in 300ms block budget)
- Jev cost: ~$0.20/hour (~12,000 decisions)
- Input tokens: ~500-800 per TradeState (compact JSON)

**Arc expectations:**
- Same latency (Jev call doesn't depend on chain)
- Slightly lower tokens if AMM state is simpler than CLOB book
- Still fits in 300ms block time (read Uniswap price ~20-50ms + Jev call ~100ms + swap ~50ms)

**Budget for advanced patterns:**
- Composite scoring (3 questions): ~3x cost, same latency (parallel)
- Speculative fan-out: proportional to question count, but only pay for what you use

## References

- **TypeSafe skill**: `.agents/skills/typesafe-ai/SKILL.md`
- **Live docs**: https://docs.typesafe.ai/llms.txt
- **System One concepts**: https://docs.typesafe.ai/concepts/system-one.md
- **Choice primitive**: https://docs.typesafe.ai/primitives/choice.md
- **Composite scoring pattern**: https://docs.typesafe.ai/patterns/composite-scoring.md
- **Confidence routing**: https://docs.typesafe.ai/patterns/confidence-routing.md
- **Current model.ts**: `src/model.ts` (Monad/Kuru implementation)

## Next Steps

1. ✅ Install TypeSafe skill (`.agents/skills/typesafe-ai`)
2. ✅ Document TypeSafe patterns for trading (this file)
3. ⬜ Implement Arc `TradeState` builder (from Uniswap price data)
4. ⬜ Adjust `QUESTIONS` for Arc/Uniswap context
5. ⬜ Test dry-run with Arc fork + Jev decisions
6. ⬜ (Later) Explore composite scoring or confidence-gated sizing

---

**Remember:** DRY_RUN=true default. No live Arc trading until Finance/Trade approval.
