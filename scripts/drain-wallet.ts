import { ethers } from 'hardhat';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const unfundedWallet = new ethers.Wallet(
    process.env.PRIVATE_KEY_UNFUNDED!,
    ethers.provider
  );
  
  const fundedWalletAddress = process.env.FUNDED_WALLET_ADDRESS!;
  
  // Get current balance
  const currentBalance = await ethers.provider.getBalance(unfundedWallet.address);
  console.log(`Current balance: ${ethers.formatEther(currentBalance)} ETH`);
  
  // Leave a tiny amount for gas (0.000001 ETH)
  const amountToLeave = ethers.parseEther("0.000001");
  const amountToSend = currentBalance - amountToLeave;
  
  if (amountToSend <= 0) {
    console.log("Balance too low to transfer");
    return;
  }
  
  // Calculate gas
  const gasPrice = await ethers.provider.getFeeData();
  const gasLimit = 21000; // Standard ETH transfer gas
  const gasCost = gasLimit * gasPrice.gasPrice;
  
  // Adjust amount to send to account for gas
  const adjustedAmount = amountToSend - gasCost;
  
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
  await tx.wait();
  
  // Check new balance
  const newBalance = await ethers.provider.getBalance(unfundedWallet.address);
  console.log(`New balance: ${ethers.formatEther(newBalance)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
