import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const EXTENDED_ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function blacklisted(address account) view returns (bool)",
  "function frozen(address account) view returns (bool)"
];

async function main() {
  const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
  const PRIVATE_KEY_UNFUNDED = process.env.PRIVATE_KEY_UNFUNDED || '';
  const TOKEN_ADDRESS = process.env.DSN_TOKEN_ADDRESS || '';
  const FUNDED_WALLET_ADDRESS = process.env.FUNDED_WALLET_ADDRESS || '';

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const unfundedWallet = new ethers.Wallet(PRIVATE_KEY_UNFUNDED, provider);
  
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, EXTENDED_ERC20_ABI, provider);
  
  console.log(`=== DSN Token Contract Analysis ===`);
  console.log(`Token Address: ${TOKEN_ADDRESS}`);
  console.log(`Sender Address: ${unfundedWallet.address}`);
  console.log(`Recipient Address: ${FUNDED_WALLET_ADDRESS}`);
  
  try {
    const [name, symbol, decimals, totalSupply, senderBalance] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(), 
      tokenContract.decimals(),
      tokenContract.totalSupply(),
      tokenContract.balanceOf(unfundedWallet.address)
    ]);
    
    console.log(`\n=== Basic Token Info ===`);
    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Decimals: ${decimals}`);
    console.log(`Total Supply: ${ethers.formatUnits(totalSupply, decimals)} ${symbol}`);
    console.log(`Sender Balance: ${ethers.formatUnits(senderBalance, decimals)} ${symbol}`);
    
    console.log(`\n=== Contract State Checks ===`);
    
    const checks = [
      { name: 'paused', call: () => tokenContract.paused() },
      { name: 'owner', call: () => tokenContract.owner() },
      { name: 'blacklisted(sender)', call: () => tokenContract.blacklisted(unfundedWallet.address) },
      { name: 'frozen(sender)', call: () => tokenContract.frozen(unfundedWallet.address) }
    ];
    
    for (const check of checks) {
      try {
        const result = await check.call();
        console.log(`${check.name}: ${result}`);
      } catch (error: any) {
        console.log(`${check.name}: Not available (${error.message?.split('(')[0] || 'Unknown error'})`);
      }
    }
    
    console.log(`\n=== Transfer Simulation ===`);
    const transferAmount = ethers.parseUnits("1.0", decimals);
    
    try {
      const transferTx = await tokenContract.transfer.populateTransaction(
        FUNDED_WALLET_ADDRESS,
        transferAmount
      );
      
      console.log(`Transfer transaction data: ${transferTx.data}`);
      
      const gasEstimate = await provider.estimateGas({
        to: TOKEN_ADDRESS,
        data: transferTx.data,
        from: unfundedWallet.address
      });
      
      console.log(`✅ Gas estimation successful: ${gasEstimate.toString()} units`);
      
    } catch (error: any) {
      console.log(`❌ Transfer simulation failed:`);
      console.log(`Error: ${error.message}`);
      
      if (error.data) {
        console.log(`Error data: ${error.data}`);
        const errorSelector = error.data.slice(0, 10);
        console.log(`Error selector: ${errorSelector}`);
        
        if (errorSelector === '0x96c6fd1e') {
          console.log(`This is the same custom error we're seeing in the top-up server!`);
        }
      }
    }
    
    console.log(`\n=== Contract Code Check ===`);
    const code = await provider.getCode(TOKEN_ADDRESS);
    console.log(`Contract has code: ${code !== '0x'}`);
    console.log(`Code length: ${code.length} characters`);
    
  } catch (error) {
    console.error("Error analyzing token contract:", error);
  }
}

main().catch(console.error);
