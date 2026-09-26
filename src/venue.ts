/**
 * Venue Adapter Interface
 * 
 * Abstracts venue-specific operations (Kuru CLOB vs Uniswap AMM) so the trading
 * loop and model can work across different chains and venues.
 */

export type Side = "buy" | "sell";

/**
 * Market data from a venue (CLOB or AMM)
 */
export interface PriceData {
  block: number;
  mid: number;
  bid: number;
  ask: number;
  spreadBps: number;
  
  /** Optional: venue-specific data for model state */
  liquidity?: {
    bidDepth: number;
    askDepth: number;
  };
  
  /** For CLOB: order book levels [price, size] */
  levels?: {
    bids: [number, number][];
    asks: [number, number][];
  };
  
  /** For AMM: recent swap events */
  recentSwaps?: {
    count: number;
    buyVolume: number;
    sellVolume: number;
    cvd: number; // cumulative volume delta
  };
}

/**
 * Result of a trade execution (or simulation)
 */
export interface TradeResult {
  txHash: string | null;
  status: "pending" | "confirmed" | "failed" | "simulated";
  side: Side;
  price: number;
  size: number;
  gasCost?: number;
  orderId?: number; // CLOB only
}

/**
 * Update for a pending transaction
 */
export interface TradeUpdate {
  block: number;
  txHash: string;
  status: "confirmed" | "failed";
  orderId?: number;
  executedPrice?: number;
  executedSize?: number;
}

/**
 * Venue adapter interface - implement for each chain/venue combination
 */
export interface VenueAdapter {
  /** Chain and venue identification */
  readonly chainId: number;
  readonly venueName: string;
  readonly pair: string;
  
  /** Wallet address (null in dry-run) */
  readonly address: string | null;
  
  /** Initialize: fetch params, setup wallet, ensure funds */
  init(): Promise<void>;
  
  /** Read current market data */
  readPrice(): Promise<PriceData>;
  
  /** Execute a trade (live mode only; dry-run returns simulated) */
  executeTrade?(side: Side, size: number, priceData: PriceData, cancel: number[], capped: boolean): Promise<TradeResult>;
  
  /** Check pending transactions (for async execution venues like CLOBs) */
  checkPending?(block: number): Promise<TradeUpdate[]>;
  
  /** Refresh venue state periodically (fees, balances, etc.) */
  refresh?(): Promise<void>;
}
