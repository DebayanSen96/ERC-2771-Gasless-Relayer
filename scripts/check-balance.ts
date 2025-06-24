import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS as `0x${string}`;
const UNFUNDED = '0xcd3B766CCDd6AE721141F452C550Ca635964ce71';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
  const bal = await token.balanceOf(UNFUNDED);
  const decimals = await token.decimals();
  console.log('Balance:', bal.toString());
  console.log('Readable:', ethers.formatUnits(bal, decimals));
})();
