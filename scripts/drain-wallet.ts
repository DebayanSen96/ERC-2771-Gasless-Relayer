import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://sepolia.base.org');
  
  const unfundedWallet = new ethers.Wallet(
    process.env.PRIVATE_KEY_UNFUNDED!,
    provider
  );
  
  const fundedWalletAddress = process.env.FUNDED_WALLET_ADDRESS!;
  
  console.log(`Unfunded wallet: ${unfundedWallet.address}`);
  console.log(`Funded wallet: ${fundedWalletAddress}`);

  // Get current balance
  const currentBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`Current balance: ${ethers.formatEther(currentBalance)} ETH`);
  
  // Leave an extremely tiny amount (0.000000001 ETH) - definitely not enough for a transaction
  const amountToLeave = ethers.parseEther("0.000000001");
  const amountToSend = currentBalance - amountToLeave;
  
  if (amountToSend <= 0) {
    console.log("Balance too low to transfer");
    return;
  }
  
  // Calculate gas cost for the transaction (estimate)
  const gasLimit = BigInt(21000); // Standard ETH transfer
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || BigInt(1000000000); // Default to 1 gwei if null
  const gasCost = gasLimit * gasPrice;

  // Calculate amount to send, leaving a small amount for gas
  const adjustedAmount = amountToSend > gasCost ? amountToSend - gasCost : BigInt(0);
  
  if (adjustedAmount <= 0) {
    console.log("Balance too low after gas costs");
    return;
  }
  
  console.log(`Sending ${ethers.formatEther(adjustedAmount)} ETH to ${fundedWalletAddress}`);
  
  // Send transaction
  const tx = await unfundedWallet.sendTransaction({
    to: fundedWalletAddress,
    value: adjustedAmount
  });
  
  console.log(`Transaction hash: ${tx.hash}`);
  console.log(`Waiting for confirmation...`);

  // Wait for the transaction to be mined
  const receipt = await provider.waitForTransaction(tx.hash);
  console.log(`Transaction confirmed in block ${receipt?.blockNumber || 'unknown'}`);

  // Check new balance
  const newBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`New balance: ${ethers.formatEther(newBalance)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
