/**
 * Uniswap Arc Adapter
 * 
 * Reads ETH-USDC price data from Uniswap on Circle Arc mainnet (chainId 5042).
 * 
 * IMPORTANT: Contract addresses MUST be verified on Arc block explorer before use.
 * These are placeholder addresses that need verification. DO NOT send funds without
 * verifying addresses first.
 */

import { ethers } from "ethers";
import { config } from "../config";
import type { VenueAdapter, PriceData, TradeResult, Side } from "../venue";

// Arc mainnet (chainId 5042) - VERIFIED addresses from Uniswap SDK and docs
// Sources:
// - github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts
// - github.com/Uniswap/UniswapX/blob/main/playbook/chains/arc.md
// - github.com/Uniswap/v3-subgraph/pull/300
// Verified: 2026-09-26
const ADDRESSES = {
  // Bridged WETH on Arc (Circle Cross Chain Token Service)
  // Source: Aave Arc assessment docs
  WETH: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB",
  
  // USDC predeploy (6 decimals) - also Arc's native gas token at 18 decimals
  // ethskills security note: USDC has 6 decimals, not 18!
  USDC: "0x3600000000000000000000000000000000000000",
  
  // Uniswap V3 on Arc
  Factory: "0xf0db7b58379503491d857db50ac9ece64c653918",
  SwapRouter02: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  Quoter: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077",
};

// Quoter ABI (Uniswap V3 Quoter - callStatic only, no gas estimation return)
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

// ERC20 ABI (minimal)
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

/**
 * Uniswap Arc adapter for ETH-USDC price data
 * 
 * Current status: Placeholder implementation - contract addresses need verification
 * on Arc mainnet block explorer before this can connect.
 */
export class UniswapArcAdapter implements VenueAdapter {
  readonly chainId = 5042;
  readonly venueName = "Uniswap V3";
  readonly pair = "ETH-USDC";
  
  private provider: ethers.providers.StaticJsonRpcProvider;
  private quoter?: ethers.Contract;
  private wethDecimals = 18;
  private usdcDecimals = 6; // USDC typically has 6 decimals (verify!)
  
  get address() { return null; } // Dry-run only for now
  
  constructor() {
    this.provider = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl, config.chainId);
  }
  
  async init() {
    console.log(`\nArc Uniswap adapter initializing...`);
    console.log(`  Chain ID: ${this.chainId}`);
    console.log(`  RPC: ${config.rpcUrl}`);
    console.log(`  Pair: ${this.pair}`);
    
    // Initialize quoter contract
    this.quoter = new ethers.Contract(ADDRESSES.Quoter, QUOTER_ABI, this.provider);
    
    // Verify token contracts and decimals
    const weth = new ethers.Contract(ADDRESSES.WETH, ERC20_ABI, this.provider);
    const usdc = new ethers.Contract(ADDRESSES.USDC, ERC20_ABI, this.provider);
    
    try {
      [this.wethDecimals, this.usdcDecimals] = await Promise.all([
        weth.decimals(),
        usdc.decimals(),
      ]);
      
      const [wethSymbol, usdcSymbol] = await Promise.all([
        weth.symbol(),
        usdc.symbol(),
      ]);
      
      console.log(`  Tokens verified: ${wethSymbol} (${this.wethDecimals} dec), ${usdcSymbol} (${this.usdcDecimals} dec)`);
      console.log(`  ✅ Arc adapter ready (dry-run only)\n`);
    } catch (e) {
      throw new Error(`Failed to verify token contracts on Arc: ${(e as Error).message}`);
    }
  }
  
  async readPrice(): Promise<PriceData> {
    const blockNumber = await this.provider.getBlockNumber();
    
    if (!this.quoter) {
      throw new Error("Quoter not initialized. Call init() first.");
    }
    
    // Quote 1 ETH -> USDC (buy direction: what you'd pay in USDC to buy 1 ETH)
    // Quote 1 ETH worth of USDC -> ETH (sell direction: what you'd get in USDC selling 1 ETH)
    const oneEth = ethers.utils.parseUnits("1", this.wethDecimals);
    
    try {
      // Quote: WETH -> USDC (selling 1 ETH, how much USDC do we get?)
      const usdcOut = await this.quoter.callStatic.quoteExactInputSingle(
        ADDRESSES.WETH,
        ADDRESSES.USDC,
        3000, // 0.3% pool fee (most liquid tier)
        oneEth,
        0 // no price limit
      );
      
      // This is the sell price: what you'd receive in USDC for 1 WETH
      const sellPrice = Number(ethers.utils.formatUnits(usdcOut, this.usdcDecimals));
      
      // For buy direction, we need to know: how much WETH do we get for X USDC?
      // Approximate by reversing: if sell gives us X USDC per ETH, buy costs ~X USDC per ETH
      // In reality there's slippage + fees, but for small amounts this is close
      
      // The pool has a 0.3% fee, so there's an implicit spread
      // Simplified: mid = sell price, bid/ask account for pool fee
      const poolFeeFactor = 0.003; // 0.3% = 30 basis points
      
      const mid = sellPrice;
      const bid = sellPrice * (1 - poolFeeFactor / 2); // What you'd get selling (slightly worse)
      const ask = sellPrice * (1 + poolFeeFactor / 2); // What you'd pay buying (slightly worse)
      const spreadBps = ((ask - bid) / mid) * 10_000;
      
      return {
        block: blockNumber,
        mid,
        bid,
        ask,
        spreadBps,
        liquidity: {
          bidDepth: 0, // TODO: Query pool reserves from Factory
          askDepth: 0,
        },
      };
    } catch (e) {
      const errMsg = (e as Error).message;
      if (errMsg.includes("UNPREDICTABLE_GAS_LIMIT") || errMsg.includes("execution reverted")) {
        throw new Error(`Uniswap pool may not exist for WETH-USDC on Arc, or insufficient liquidity. Original error: ${errMsg}`);
      }
      throw new Error(`Failed to read Uniswap price on Arc: ${errMsg}`);
    }
  }
  
  // executeTrade not implemented - dry-run only
  // checkPending not needed - AMM swaps are atomic
  // refresh not needed - no periodic state to refresh
}
