import { experimental_evaluate } from "ai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { config } from "./config";

/** Models answer buy or sell. `hold` only appears on late blocks (no decision was made). */
export type Action = "buy" | "sell" | "hold";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
  market: string; // "MON-USDC" or "ETH-USDC" etc.
  venue?: string; // "Kuru" or "Uniswap V3" etc.
  block: number;
  horizonBlocks: number; // the question is about the move over this many blocks
  blockMs: number;
  mid: number;
  spreadBps: number;
  
  // CLOB-specific fields (optional for AMM venues)
  bookImbalance?: number; // -1 (all asks) .. 1 (all bids), within 1% of mid
  /** Cumulative resting MON within 10/25/50 bps of mid, per side. */
  depth?: { [band: string]: { bid: number; ask: number } };
  /** Top 5 levels each side, best first, as "price x size". */
  book?: { bids: string[]; asks: string[] };
  
  // Common fields
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string; // oldest..newest, sampled every 5 blocks over the horizon, space separated
  /** Taker prints over the last `horizonBlocks`. cvdMon = taker buy volume - taker sell volume. */
  trades: { count: number; buyMon: number; sellMon: number; cvdMon: number; vwap: number | null; lastPrice: number | null; lastSide: "buy" | "sell" | null };
  recentTrades: string[]; // newest last, "block side size @ price"
  allowed: { buy: boolean; sell: boolean };
}

export interface Decision {
  action: Action;
  probabilities: Record<Action, number>;
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<Decision>;
}

/** Arc ETH-USDC / Uniswap vs Monad MON-USDC / Kuru. */
function isArcEth(state: TradeState): boolean {
  const market = state.market ?? "";
  const venue = state.venue ?? "";
  return /ETH-?USDC/i.test(market) || /uniswap/i.test(venue);
}

function buildQuestions(state: TradeState) {
  if (isArcEth(state)) {
    return {
      direction: {
        type: "choice" as const,
        instructions: {
          question: "Will ETH be higher or lower than the current mid after `horizonBlocks` more blocks?",
          goal: "Trade ETH-USDC on Uniswap (Arc). Blocks are ~`blockMs`ms; `horizonBlocks` is the horizon. A decision is made every few blocks and held until the next one. The trade crosses the spread (`spreadBps`), so the move must beat that cost.",
          timing: "The order executes as an immediate-or-cancel market order in the next block.",
          inputs: "`returnsBps` and `recentMids` show the path over the horizon. AMM venues may omit CLOB `book`/`depth`; when present, thin depth on one side means price moves easily that way. `trades` may be sparse on Arc. If `allowed.buy` is false the trade will be a sell regardless, and vice versa.",
        },
        criteria: {
          buy: "Buy ETH now: mid more likely to be higher after `horizonBlocks` blocks, by more than the spread.",
          sell: "Sell ETH now: mid more likely to be lower after `horizonBlocks` blocks, by more than the spread.",
        },
      },
    };
  }

  return {
    direction: {
      type: "choice" as const,
      instructions: {
        question: "Will MON be higher or lower than the current mid after `horizonBlocks` more blocks?",
        goal: "Trade MON-USDC on Kuru. Blocks are ~300ms; `horizonBlocks` (~30 s) is the horizon. A decision is made every few blocks and held until the next one. The trade crosses the spread (`spreadBps`), so the move must beat that cost.",
        timing: "The order executes as an immediate-or-cancel market order in the next block.",
        inputs: "Taker flow is the strongest signal: `trades.cvdMon` (taker buys minus taker sells over the horizon), `trades.lastSide` and `recentTrades` show who is hitting the book. `depth` and `book` show resting liquidity per side at several distances from mid; thin depth on one side means price moves easily that way. `returnsBps` and `recentMids` show the path over the horizon. If `allowed.buy` is false the trade will be a sell regardless, and vice versa.",
      },
      criteria: {
        buy: "Buy MON now: mid more likely to be higher after `horizonBlocks` blocks, by more than the spread.",
        sell: "Sell MON now: mid more likely to be lower after `horizonBlocks` blocks, by more than the spread.",
      },
    },
  };
}

/** Real TypeSafe evaluation (Jev hosted or live Laya). Swap-in is the MODEL env var. */
export class TypeSafeModel implements Model {
  readonly name: string;
  private model: ReturnType<ReturnType<typeof createTypeSafeAi>["evaluationModel"]>;

  constructor(name: string, modelId: string, opts?: { apiKey?: string; baseURL?: string }) {
    this.name = name;
    const provider = opts?.apiKey || opts?.baseURL
      ? createTypeSafeAi({ apiKey: opts.apiKey, baseURL: opts.baseURL })
      : createTypeSafeAi();
    this.model = provider.evaluationModel(modelId);
  }

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    const r = await experimental_evaluate({
      model: this.model,
      state: state as any,
      questions: buildQuestions(state),
      maxRetries: 0,
    });
    const a = r.answers.direction;
    const p = a.probabilities ?? { buy: 0, sell: 0, [a.choice]: 1 };
    const buy = p.buy ?? 0, sell = p.sell ?? 0;
    return {
      action: a.choice as Action,
      probabilities: { buy, sell, hold: 0 },
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: r.usage?.inputTokens ?? 0,
    };
  }
}

/** @deprecated alias — prefer TypeSafeModel */
export class JevModel extends TypeSafeModel {
  constructor() {
    super(config.jevModelId, config.jevModelId);
  }
}

/** Deterministic stand-in: momentum + imbalance + mean reversion toward flat. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    // momentum + book imbalance + noise, pulled back toward flat so it trades both ways
    const flow = state.trades.buyMon + state.trades.sellMon ? state.trades.cvdMon / (state.trades.buyMon + state.trades.sellMon) : 0;
    const signal = state.returnsBps.last20 / 8 + (state.bookImbalance ?? 0) * 1.5 + flow * 2 + this.noise(state.block);
    const buy = 1 / (1 + Math.exp(-signal)); // binary softmax
    const probabilities = { buy, sell: 1 - buy, hold: 0 };
    const action: Action = buy >= 0.5 ? "buy" : "sell";
    await Bun.sleep(80); // stand in for inference time so the pipeline behaves like production
    return {
      action, probabilities,
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    };
  }

  private noise(block: number) {
    let h = block * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => {
  if (config.model === "laya") {
    if (!config.layaApiKey) throw new Error("MODEL=laya requires LAYA_API_KEY");
    return new TypeSafeModel("laya", "laya", {
      apiKey: config.layaApiKey,
      baseURL: config.layaBaseUrl,
    });
  }
  if (config.model === "jev") {
    return new TypeSafeModel(config.jevModelId, config.jevModelId);
  }
  return new MockModel();
};
