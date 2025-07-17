import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// ERC20 Token ABI (minimal for transfer)
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// Environment variables
const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const PRIVATE_KEY_UNFUNDED = process.env.PRIVATE_KEY_UNFUNDED || '';
const FUNDED_WALLET_ADDRESS = process.env.FUNDED_WALLET_ADDRESS || '';
const TOKEN_ADDRESS = process.env.DSN_TOKEN_ADDRESS || ''; // Using DSN token that the wallet already has

if (!PRIVATE_KEY_UNFUNDED) throw new Error("PRIVATE_KEY_UNFUNDED is required in .env");
if (!FUNDED_WALLET_ADDRESS) throw new Error("FUNDED_WALLET_ADDRESS is required in .env");
if (!TOKEN_ADDRESS) throw new Error("TOKEN_ADDRESS is required in .env");

// Top-up server URL
const TOPUP_SERVER_URL = process.env.TOPUP_SERVER_URL || "https://erc-2771-gasless-relayer.onrender.com";

async function main() {
  console.log("Testing simple top-up and transfer flow...");
  
  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Disable ENS lookups since Base Sepolia doesn't support it
  provider.getResolver = async () => null;
  const unfundedWallet = new ethers.Wallet(PRIVATE_KEY_UNFUNDED, provider);
  
  // Get token contract
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
  const tokenSymbol = await tokenContract.symbol();
  const tokenDecimals = await tokenContract.decimals();
  
  // Check initial balances
  const initialEthBalance = await provider.getBalance(unfundedWallet.address);
  const initialTokenBalance = await tokenContract.balanceOf(unfundedWallet.address);
  const recipientTokenBalance = await tokenContract.balanceOf(FUNDED_WALLET_ADDRESS);
  
  console.log(`Unfunded wallet address: ${unfundedWallet.address}`);
  console.log(`Recipient address: ${FUNDED_WALLET_ADDRESS}`);
  console.log(`Unfunded wallet ETH balance: ${ethers.formatEther(initialEthBalance)} ETH`);
  console.log(`Initial sender ${tokenSymbol} balance: ${ethers.formatUnits(initialTokenBalance, tokenDecimals)} ${tokenSymbol}`);
  console.log(`Initial recipient ${tokenSymbol} balance: ${ethers.formatUnits(recipientTokenBalance, tokenDecimals)} ${tokenSymbol}`);
  
  // Define transfer amount (1 token with proper decimals)
  const transferAmount = ethers.parseUnits("1.0", tokenDecimals);
  
  console.log(`\nStep 1: Requesting top-up (server-side estimation)...`);
  
  // Create transfer transaction for gas estimation
  const transferTx = await tokenContract.transfer.populateTransaction(
    FUNDED_WALLET_ADDRESS,
    transferAmount
  );
  
  const txPayload = {
    to: TOKEN_ADDRESS,
    data: transferTx.data!,
    value: "0"
  };
  
  const message = ethers.solidityPacked(
    ['address','address','bytes','uint256'],
    [unfundedWallet.address, txPayload.to, txPayload.data, 0n]
  );
  const signature = await unfundedWallet.signMessage(message);
  
  try {
    const topupResponse = await axios.post(`${TOPUP_SERVER_URL}/topup`, {
      address: unfundedWallet.address,
      tx: txPayload,
      signature
    });
    console.log("Top-up response:", topupResponse.data);
    if (topupResponse.data.transactionHash) {
      console.log(`Top-up transaction hash: ${topupResponse.data.transactionHash}`);
      console.log("Waiting for top-up transaction to be mined...");
      await provider.waitForTransaction(topupResponse.data.transactionHash);
    }
  } catch (error) {
    console.error("Error requesting top-up:", error);
    if (axios.isAxiosError(error) && error.response) {
      console.error("Server response:", error.response.data);
    }
    process.exit(1);
  }
  
  const updatedEthBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`Updated ETH balance: ${ethers.formatEther(updatedEthBalance)} ETH`);
  
  console.log(`\nStep 2: Sending token transfer transaction...`);
  

  
  // Send the transfer transaction
  try {
    const tokenContractWithSigner = tokenContract.connect(unfundedWallet) as ethers.Contract;
    const tx = await tokenContractWithSigner.transfer(FUNDED_WALLET_ADDRESS, transferAmount);
    
    console.log(`Transfer transaction hash: ${tx.hash}`);
    console.log("Waiting for transfer transaction to be mined...");
    
    const receipt = await tx.wait();
    console.log(`Transfer transaction confirmed in block ${receipt?.blockNumber}`);
  } catch (error) {
    console.error("Error sending transfer transaction:", error);
    process.exit(1);
  }
  
  // Check final balances
  const finalEthBalance = await provider.getBalance(unfundedWallet.address);
  const finalTokenBalance = await tokenContract.balanceOf(unfundedWallet.address);
  const finalRecipientTokenBalance = await tokenContract.balanceOf(FUNDED_WALLET_ADDRESS);
  
  console.log(`\nStep 4: Checking final balances...`);
  console.log(`Final ETH balance: ${ethers.formatEther(finalEthBalance)} ETH`);
  console.log(`Final sender ${tokenSymbol} balance: ${ethers.formatUnits(finalTokenBalance, tokenDecimals)} ${tokenSymbol}`);
  console.log(`Final recipient ${tokenSymbol} balance: ${ethers.formatUnits(finalRecipientTokenBalance, tokenDecimals)} ${tokenSymbol}`);
  
  // Calculate changes
  const ethChange = finalEthBalance - initialEthBalance;
  const tokenChange = finalTokenBalance - initialTokenBalance;
  const recipientTokenChange = finalRecipientTokenBalance - recipientTokenBalance;
  
  console.log(`\nETH spent on gas: ${ethers.formatEther(ethChange * -1n)} ETH`);
  console.log(`Sender token balance change: ${ethers.formatUnits(tokenChange, tokenDecimals)} ${tokenSymbol}`);
  console.log(`Recipient token balance change: ${ethers.formatUnits(recipientTokenChange, tokenDecimals)} ${tokenSymbol}`);
  
  if (recipientTokenChange > 0n) {
    console.log(`\n✅ Token transfer successful!`);
    console.log(`${ethers.formatUnits(transferAmount, tokenDecimals)} ${tokenSymbol} tokens were transferred from the unfunded wallet to the recipient.`);
    console.log(`Gas was sponsored by the top-up service.`);
  } else {
    console.log(`\n❌ Token transfer failed or not confirmed yet.`);
  }
}

// Execute the script
main().catch((error) => {
  console.error("Error in main execution:", error);
  process.exit(1);
});
