export interface Token {
  name: string;
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  logoURI: string;
}

// Mainnet Tokens (Chain ID: 1)
const MAINNET_TOKENS: Token[] = [
  {
    chainId: 1,
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    logoURI: "https://raw.githubusercontent.com/maticnetwork/polygon-token-assets/main/assets/tokenAssets/weth.svg",
  },
  {
    chainId: 1,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    logoURI: "https://raw.githubusercontent.com/maticnetwork/polygon-token-assets/main/assets/tokenAssets/usdc.svg",
  },
  {
    chainId: 1,
    name: "Dai - PoS",
    symbol: "DAI",
    decimals: 18,
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    logoURI: "https://raw.githubusercontent.com/maticnetwork/polygon-token-assets/main/assets/tokenAssets/dai.svg",
  },
  {
    chainId: 1,
    name: "FLOKI",
    symbol: "FLOKI",
    decimals: 9,
    address: "0xcf0c122c6b73ff809c693db761e7baebe62b6a2e",
    logoURI:
      "https://raw.githubusercontent.com/trustwallet/assets/c37119334a24f9933f373c6cc028a5bdbad2ecb4/blockchains/ethereum/assets/0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E/logo.png",
  },
];

// Base Tokens (Chain ID: 8453)
const BASE_TOKENS: Token[] = [
  {
    chainId: 8453,
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    address: "0x4200000000000000000000000000000000000006",
    logoURI: "https://raw.githubusercontent.com/maticnetwork/polygon-token-assets/main/assets/tokenAssets/weth.svg",
  },
  {
    chainId: 8453,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    logoURI: "https://raw.githubusercontent.com/maticnetwork/polygon-token-assets/main/assets/tokenAssets/usdc.svg",
  },
  {
    chainId: 8453,
    name: "Dai Stablecoin",
    symbol: "DAI",
    decimals: 18,
    address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
    logoURI: "https://raw.githubusercontent.com/maticnetwork/polygon-token-assets/main/assets/tokenAssets/dai.svg",
  },
  {
    chainId: 8453,
    name: "Coinbase Wrapped Staked ETH",
    symbol: "cbETH",
    decimals: 18,
    address: "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
    logoURI: "https://assets.coingecko.com/coins/images/27008/large/cbeth.png",
  },
  {
    chainId: 8453,
    name: "Base",
    symbol: "BASE",
    decimals: 18,
    address: "0xd07379a755a8f11b57610154861d694b2a0f615a",
    logoURI: "https://assets.coingecko.com/coins/images/31164/large/base-logo-in-blue.png",
  },
];

export const TOKENS_BY_NETWORK: Record<string, Token[]> = {
  'ethereum': MAINNET_TOKENS,
  'mainnet': MAINNET_TOKENS,
  '1': MAINNET_TOKENS,
  'base': BASE_TOKENS,
  'base-mainnet': BASE_TOKENS,
  '8453': BASE_TOKENS,
};

export const getTokensByNetwork = (network: string): Token[] => {
  const normalizedNetwork = network.toLowerCase();
  return TOKENS_BY_NETWORK[normalizedNetwork] || [];
};
