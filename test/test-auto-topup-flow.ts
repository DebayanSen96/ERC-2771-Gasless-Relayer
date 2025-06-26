import { ethers } from "hardhat";
import { TypedDataDomain } from "ethers";
import * as dotenv from "dotenv";
import axios from "axios";

// Load environment variables
dotenv.config();

// Contract ABIs
const DSNTokenABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)"
];

async function main() {
  console.log("Testing auto top-up flow for standard ERC20 tokens...");

  // Get addresses from .env
  const dsnTokenAddress = process.env.DSN_TOKEN_ADDRESS;
  const rpcUrl = process.env.RPC_URL || "https://sepolia.base.org";

  if (!dsnTokenAddress) {
    throw new Error("Missing contract addresses in .env file");
  }

  // Create unfunded wallet (with no ETH for gas)
  const unfundedPrivateKey = process.env.PRIVATE_KEY_UNFUNDED;
  if (!unfundedPrivateKey) {
    throw new Error("PRIVATE_KEY_UNFUNDED not found in .env file");
  }

  // Get funded wallet address for transfer recipient
  const fundedWalletAddress = process.env.FUNDED_WALLET_ADDRESS || "0x578636C1CDfd5BCA3F1e787Fa49c2ea664c7bd8C";

  // Create provider and wallet
  const provider = ethers.provider;
  const unfundedWallet = new ethers.Wallet(unfundedPrivateKey, provider);
  console.log(`Unfunded wallet address: ${unfundedWallet.address}`);
  console.log(`Funded wallet address (recipient): ${fundedWalletAddress}`);

  // Check ETH balance to confirm it's unfunded or has minimal funds
  const initialEthBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`Initial ETH balance: ${ethers.formatEther(initialEthBalance)} ETH`);
  
  // Connect to DSN token contract
  const dsnToken = new ethers.Contract(dsnTokenAddress, DSNTokenABI, provider);
  
  // Check initial DSN token balances
  const initialSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
  const initialRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
  console.log(`Initial sender DSN balance: ${ethers.formatEther(initialSenderBalance)} DSN`);
  console.log(`Initial recipient DSN balance: ${ethers.formatEther(initialRecipientBalance)} DSN`);

  // Amount to transfer (10 tokens with 18 decimals)
  const transferAmount = ethers.parseEther("10");

  // Check if we have enough balance
  if (initialSenderBalance < transferAmount) {
    throw new Error(`Insufficient DSN balance. Have ${ethers.formatEther(initialSenderBalance)}, need ${ethers.formatEther(transferAmount)}`);
  }

  console.log("\nStep 1: Direct ERC20 transfer using auto top-up...");
  
  // Create a signer for the unfunded wallet
  const signer = unfundedWallet.connect(provider);
  
  // Connect to the DSN token with the signer
  const dsnTokenWithSigner = dsnToken.connect(signer);
  
  try {
    // This would normally fail if the wallet has no ETH, but our relayer should top up
    console.log(`Sending ${ethers.formatEther(transferAmount)} DSN tokens directly to ${fundedWalletAddress}...`);
    const tx = await dsnTokenWithSigner.transfer(fundedWalletAddress, transferAmount);
    
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for transaction to be mined...");
    
    const receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    // Check final balances
    const finalEthBalance = await provider.getBalance(unfundedWallet.address);
    const finalSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
    const finalRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
    
    console.log(`\nFinal ETH balance: ${ethers.formatEther(finalEthBalance)} ETH`);
    console.log(`Final sender DSN balance: ${ethers.formatEther(finalSenderBalance)} DSN`);
    console.log(`Final recipient DSN balance: ${ethers.formatEther(finalRecipientBalance)} DSN`);
    
    // Calculate and display the differences
    const ethBalanceDiff = finalEthBalance - initialEthBalance;
    const senderBalanceDiff = finalSenderBalance - initialSenderBalance;
    const recipientBalanceDiff = finalRecipientBalance - initialRecipientBalance;
    
    console.log(`\nETH balance change: ${ethers.formatEther(ethBalanceDiff)} ETH`);
    console.log(`Sender DSN balance change: ${ethers.formatEther(senderBalanceDiff)} DSN`);
    console.log(`Recipient DSN balance change: ${ethers.formatEther(recipientBalanceDiff)} DSN`);
    
    if (recipientBalanceDiff > 0) {
      console.log("\n✅ Auto top-up and direct ERC20 transfer successful!");
      console.log(`The relayer topped up the sender with ETH, allowing them to pay for gas for a standard ERC20 transfer.`);
    } else {
      console.log("\n❌ Token transfer did not increase recipient balance");
    }
  } catch (error) {
    console.error("Error during transfer:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
