import { ethers } from 'hardhat';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const unfundedWalletAddress = new ethers.Wallet(
    process.env.PRIVATE_KEY_UNFUNDED!
  ).address;

  const ethBalance = await ethers.provider.getBalance(unfundedWalletAddress);
  
  console.log(`Wallet address: ${unfundedWalletAddress}`);
  console.log(`Current ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
