/**
 * Adapter Factory
 * 
 * Creates the appropriate VenueAdapter based on chain configuration.
 */

import { config, CHAINS } from "./config";
import type { VenueAdapter } from "./venue";
import { UniswapArcAdapter } from "./venues/uniswap-arc";

// Import the existing Market class as the Kuru adapter
// (We'll wrap it below rather than refactoring the entire Market class)
import { Market } from "./market";

/**
 * Kuru adapter wraps the existing Market class to implement VenueAdapter interface
 */
class KuruMarketAdapter implements VenueAdapter {
  readonly chainId = CHAINS.MONAD.id;
  readonly venueName = "Kuru";
  readonly pair = "MON-USDC";
  
  private market: Market;
  
  constructor() {
    this.market = new Market();
  }
  
  get address() {
    return this.market.address;
  }
  
  async init() {
    await this.market.init();
  }
  
  async readPrice() {
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
  
  // Expose the underlying Market for backward compatibility
  get _market() {
    return this.market;
  }
}

/**
 * Create venue adapter based on CHAIN config
 */
export function createVenueAdapter(): VenueAdapter {
  if (config.chainId === CHAINS.ARC.id) {
    console.log(`Creating Arc Uniswap adapter (chainId ${CHAINS.ARC.id})`);
    return new UniswapArcAdapter();
  }
  
  console.log(`Creating Monad Kuru adapter (chainId ${CHAINS.MONAD.id})`);
  return new KuruMarketAdapter();
}

/**
 * Type guard to check if adapter is KuruMarketAdapter
 */
export function isKuruAdapter(adapter: VenueAdapter): adapter is KuruMarketAdapter {
  return adapter.venueName === "Kuru";
}

/**
 * Get the underlying Market instance for Kuru (backward compatibility)
 */
export function getMarketIfKuru(adapter: VenueAdapter): Market | null {
  if (isKuruAdapter(adapter)) {
    return adapter._market;
  }
  return null;
}
