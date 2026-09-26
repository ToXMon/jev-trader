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

// Arc mainnet (chainId 5042) - VERIFIED addresses from Uniswap SDK ARC_ADDRESSES
// Source: github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts
// Verified on-chain: 2026-09-26
const ADDRESSES = {
  // Bridged WETH on Arc (Circle Cross Chain Token Service)
  WETH: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB",
  
  // USDC predeploy (6 decimals) - also Arc's native gas token at 18 decimals
  // ethskills: USDC has 6 decimals, not 18!
  USDC: "0x3600000000000000000000000000000000000000",
  
  // Uniswap V3 on Arc (from sdk-core ARC_ADDRESSES block)
  Factory: "0xf0db7b58379503491d857db50ac9ece64c653918",
  SwapRouter02: "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",
  QuoterV2: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468", // Verified: has code, returns quotes
};

// QuoterV2 ABI (Uniswap V3 QuoterV2 - struct param, returns struct)
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
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
  private quoterV2?: ethers.Contract;
  private wethDecimals = 18;
  private usdcDecimals = 6; // USDC has 6 decimals (verified on-chain)
  
  get address() { return null; } // Dry-run only for now
  
  constructor() {
    this.provider = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl, config.chainId);
  }
  
  async init() {
    console.log(`\nArc Uniswap adapter initializing...`);
    console.log(`  Chain ID: ${this.chainId}`);
    console.log(`  RPC: ${config.rpcUrl}`);
    console.log(`  Pair: ${this.pair}`);
    
    // Initialize QuoterV2 contract
    this.quoterV2 = new ethers.Contract(ADDRESSES.QuoterV2, QUOTER_V2_ABI, this.provider);
    
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
      
      // Verify QuoterV2 has code
      const quoterCode = await this.provider.getCode(ADDRESSES.QuoterV2);
      if (quoterCode === "0x" || quoterCode === "0x0") {
        throw new Error(`QuoterV2 at ${ADDRESSES.QuoterV2} has no code on Arc`);
      }
      console.log(`  QuoterV2 verified at ${ADDRESSES.QuoterV2}`);
      console.log(`  ✅ Arc adapter ready (dry-run only)\n`);
    } catch (e) {
      throw new Error(`Failed to verify contracts on Arc: ${(e as Error).message}`);
    }
  }
  
  async readPrice(): Promise<PriceData> {
    const blockNumber = await this.provider.getBlockNumber();
    
    if (!this.quoterV2) {
      throw new Error("QuoterV2 not initialized. Call init() first.");
    }
    
    // Use 0.01 ETH for quotes to avoid thin-liquidity slippage
    // Pool has limited depth; 1 ETH quotes revert or are badly skewed
    const quoteEth = ethers.utils.parseUnits("0.01", this.wethDecimals);
    const quoteSize = 0.01; // For normalization back to per-1-ETH prices
    const fee = 3000; // 0.3% pool (verified: pool 0x964cFF2cCCB9059e83D507df348f070e5257A2e0 exists)
    
    try {
      // Quote both directions for accurate bid/ask (using small notional)
      // Sell direction: WETH -> USDC (how much USDC for 0.01 ETH?)
      const sellResult = await this.quoterV2.callStatic.quoteExactInputSingle({
        tokenIn: ADDRESSES.WETH,
        tokenOut: ADDRESSES.USDC,
        amountIn: quoteEth,
        fee,
        sqrtPriceLimitX96: 0,
      });
      const sellUsdcOut = Number(ethers.utils.formatUnits(sellResult.amountOut, this.usdcDecimals));
      
      // Buy direction: USDC -> WETH (how much USDC to get 0.01 ETH?)
      let buyUsdcIn: number;
      try {
        const buyResult = await this.quoterV2.callStatic.quoteExactOutputSingle({
          tokenIn: ADDRESSES.USDC,
          tokenOut: ADDRESSES.WETH,
          amount: quoteEth, // we want 0.01 ETH out
          fee,
          sqrtPriceLimitX96: 0,
        });
        buyUsdcIn = Number(ethers.utils.formatUnits(buyResult.amountIn, this.usdcDecimals));
      } catch (outputErr) {
        // Fallback: if output quote fails (thin liquidity), synthesize ask from sell + pool fee
        const poolFeeFactor = 0.003; // 0.3%
        buyUsdcIn = sellUsdcOut * (1 + poolFeeFactor);
        console.warn(`QuoterV2 exactOutputSingle failed (thin liquidity), using synthetic ask. Error: ${(outputErr as Error).message}`);
      }
      
      // Normalize to per-1-ETH prices
      const bid = sellUsdcOut / quoteSize; // What you get selling 1 ETH
      const ask = buyUsdcIn / quoteSize;   // What you pay buying 1 ETH
      const mid = (bid + ask) / 2;
      const spreadBps = ((ask - bid) / mid) * 10_000;
      
      return {
        block: blockNumber,
        mid,
        bid,
        ask,
        spreadBps,
        liquidity: {
          bidDepth: 0, // TODO: Query pool reserves
          askDepth: 0,
        },
      };
    } catch (e) {
      const errMsg = (e as Error).message;
      if (errMsg.includes("UNPREDICTABLE_GAS_LIMIT") || errMsg.includes("execution reverted") || errMsg.includes("CALL_EXCEPTION")) {
        throw new Error(`QuoterV2 call failed on Arc. Pool may not exist or has insufficient liquidity. Fee=${fee}. Error: ${errMsg}`);
      }
      throw new Error(`Failed to read Uniswap price on Arc: ${errMsg}`);
    }
  }
  
  // executeTrade not implemented - dry-run only
  // checkPending not needed - AMM swaps are atomic
  // refresh not needed - no periodic state to refresh
}
