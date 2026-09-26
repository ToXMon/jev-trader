const env = (key: string, fallback?: string) => process.env[key] ?? fallback;
const num = (key: string) => (env(key) ? Number(env(key)) : undefined);

export const CHAINS = {
  MONAD: { id: 143, name: "Monad" },
  ARC: { id: 5042, name: "Arc" },
} as const;

const getChainDefaults = () => {
  const alchemyKey = env("ALCHEMY_API_KEY");
  const chainName = env("CHAIN", "monad").toLowerCase();
  
  if (chainName === "arc") {
    const rpcBase = alchemyKey
      ? `https://arc-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : env("RPC_URL", "https://arc-mainnet.g.alchemy.com/v2/your-api-key");
    return {
      chainId: CHAINS.ARC.id,
      rpcUrl: rpcBase,
      readRpcUrl: rpcBase,
      wsUrl: undefined,
    };
  }
  
  return {
    chainId: CHAINS.MONAD.id,
    rpcUrl: env("RPC_URL", "https://rpc.monad.xyz")!,
    readRpcUrl: env("READ_RPC_URL", "https://rpc.monad.xyz")!,
    wsUrl: env("WS_URL"),
  };
};

const defaults = getChainDefaults();

export const config = {
  rpcUrl: env("RPC_URL") ?? defaults.rpcUrl,
  readRpcUrl: env("READ_RPC_URL") ?? defaults.readRpcUrl,
  wsUrl: env("WS_URL") ?? defaults.wsUrl,
  chainId: defaults.chainId,
  market: env("MARKET", "0x065C9d28E428A0db40191a54d33d5b7c71a9C394")!, // Kuru MON-USDC
  /** Kuru MarginAccount this market settles against (slot 73 of the OrderBook proxy; verifiedMarket(market) is true). */
  marginAccount: env("MARGIN_ACCOUNT", "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5")!,
  privateKey: env("PRIVATE_KEY"),
  dryRun: env("DRY_RUN") === "true" || !env("PRIVATE_KEY"),
  tradeSizeMon: Number(env("TRADE_SIZE_MON", "200")), // Kuru MON-USDC minimum order is 200 MON
  maxPositionMon: Number(env("MAX_POSITION_MON", "1000")),
  bankrollUsd: Number(env("BANKROLL_USD", "100")), // used for pnlPct
  /** Quote this many ticks inside the touch (0 = join the best bid/ask). Never crosses: clamps to the touch when the spread is too tight. */
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  /** Startup deposits into the Kuru margin account, topped up to these balances. Limit orders draw from margin, not the wallet. */
  marginMon: Number(env("MARGIN_MON", "600")),
  marginUsdc: Number(env("MARGIN_USDC", "20")),
  // Monad charges gas on the LIMIT, so never estimate per block: estimate once at init (or override) and hardcode.
  gasLimit: num("GAS_LIMIT"),
  gasLimitFallback: 350_000, // batchUpdate: one cancel + one post-only place measured at ~282k for the place alone
  // EIP-1559 type-2 only. Effective price = base + priority, so a high static cap is free.
  maxFeeGwei: Number(env("MAX_FEE_GWEI", "400")),
  priorityFeeGwei: Number(env("PRIORITY_FEE_GWEI", "2")), // Monad hardcodes eth_maxPriorityFeePerGas at 2
  pendingBlocks: 10, // give up on a tx with no receipt after this many blocks
  refreshBlocks: 200, // how often to refresh the fee estimate, margin balances and the vault check
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")), // the model is asked about the move over this many blocks (~30 s)
  model: env("MODEL", "mock") as "mock" | "jev" | "laya",
  jevModelId: env("JEV_MODEL_ID", "jev-latest")!,
  /** Live Akash laya-serve TypeSafe-compatible base (SDK posts to `${baseURL}/systemone`). */
  layaBaseUrl: env(
    "LAYA_BASE_URL",
    "http://provider.h4i-dedicated.eu-sw-2.digitalfrontier.so:30131/v1",
  )!,
  layaApiKey: env("LAYA_API_KEY"),
  jevUsdPerMTok: 0.042,
  port: Number(env("PORT", "3000")),
  historySize: 1000,
};
