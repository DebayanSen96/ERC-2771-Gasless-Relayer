import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Environment variables
const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const PRIVATE_KEY_UNFUNDED = process.env.PRIVATE_KEY_UNFUNDED || '';
const FUNDED_WALLET_ADDRESS = process.env.FUNDED_WALLET_ADDRESS || '';
const TOPUP_SERVER_URL = process.env.TOPUP_SERVER_URL || "https://erc-2771-gasless-relayer.onrender.com";

if (!PRIVATE_KEY_UNFUNDED) throw new Error("PRIVATE_KEY_UNFUNDED is required in .env");
if (!FUNDED_WALLET_ADDRESS) throw new Error("FUNDED_WALLET_ADDRESS is required in .env");

async function main() {
  console.log("Testing ETH transfer flow with top-up...");
  
  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const unfundedWallet = new ethers.Wallet(PRIVATE_KEY_UNFUNDED, provider);
  
  // Check initial balances
  const initialEthBalance = await provider.getBalance(unfundedWallet.address);
  const recipientInitialBalance = await provider.getBalance(FUNDED_WALLET_ADDRESS);
  
  console.log(`Unfunded wallet: ${unfundedWallet.address}`);
  console.log(`Recipient: ${FUNDED_WALLET_ADDRESS}`);
  console.log(`Initial sender ETH: ${ethers.formatEther(initialEthBalance)} ETH`);
  console.log(`Initial recipient ETH: ${ethers.formatEther(recipientInitialBalance)} ETH`);
  
  // Prepare the transaction payload (simple ETH transfer)
  const transferAmount = ethers.parseEther("0.00005"); // Reduced to 0.00005 ETH to ensure enough for gas
  console.log(`\nStep 1: Requesting top-up for ETH transfer...`);
  
  // Create ETH transfer transaction for gas estimation
  const txPayload = {
    to: FUNDED_WALLET_ADDRESS,
    value: transferAmount.toString(),
    data: "0x" // Empty data for simple ETH transfer
  };
  
  // Sign the message - using the same format as the working ERC20 test
  const message = ethers.solidityPacked(
    ['address', 'address', 'bytes', 'uint256'],
    [unfundedWallet.address, txPayload.to, txPayload.data ?? '0x', BigInt(txPayload.value)]
  );
  const signature = await unfundedWallet.signMessage(message);
  
  try {
    // Request top-up
    console.log("Sending top-up request to server...");
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
    
    // Check updated balance after top-up
    const updatedEthBalance = await provider.getBalance(unfundedWallet.address);
    console.log(`Updated ETH balance: ${ethers.formatEther(updatedEthBalance)} ETH`);
    
    console.log(`\nStep 2: Sending ETH transfer...`);
    
    // Send the ETH transfer
    const tx = await unfundedWallet.sendTransaction({
      to: FUNDED_WALLET_ADDRESS,
      value: transferAmount
    });
    
    console.log(`Transfer transaction hash: ${tx.hash}`);
    console.log("Waiting for transfer transaction to be mined...");
    
    const receipt = await tx.wait();
    console.log(`Transfer confirmed in block ${receipt?.blockNumber}`);
    
    // Check final balances
    const finalSenderBalance = await provider.getBalance(unfundedWallet.address);
    const finalRecipientBalance = await provider.getBalance(FUNDED_WALLET_ADDRESS);
    
    console.log(`\nFinal sender ETH: ${ethers.formatEther(finalSenderBalance)} ETH`);
    console.log(`Final recipient ETH: ${ethers.formatEther(finalRecipientBalance)} ETH`);
    
    const ethSent = ethers.formatEther(transferAmount);
    console.log(`\n✅ Successfully sent ${ethSent} ETH from ${unfundedWallet.address} to ${FUNDED_WALLET_ADDRESS}`);
    
  } catch (error) {
    console.error("Error in ETH transfer flow:", error);
    if (axios.isAxiosError(error) && error.response) {
      console.error("Server response:", error.response.data);
    }
    process.exit(1);
  }
}

// Execute the script
main().catch((error) => {
  console.error("Error in main execution:", error);
  process.exit(1);
});
