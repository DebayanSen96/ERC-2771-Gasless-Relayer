import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function main() {
  console.log("Starting deployment of TokenProxy and DSNToken...");

  // Get the deployer account using the funded private key
  const privateKey = process.env.PRIVATE_KEY_FUNDED;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY_FUNDED not found in .env file");
  }

  // Get the provider from hardhat config
  const provider = ethers.provider;
  
  // Create wallet from private key
  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Deploying from account: ${wallet.address}`);
  
  // Get the balance of the deployer
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  // Deploy MinimalForwarder if not already deployed
  let forwarderAddress = process.env.FORWARDER_ADDRESS;
  if (!forwarderAddress) {
    console.log("Deploying MinimalForwarder...");
    const MinimalForwarder = await ethers.getContractFactory("MinimalForwarder", wallet);
    const forwarder = await MinimalForwarder.deploy();
    await forwarder.waitForDeployment();
    forwarderAddress = await forwarder.getAddress();
    console.log(`MinimalForwarder deployed to: ${forwarderAddress}`);
  } else {
    console.log(`Using existing MinimalForwarder at: ${forwarderAddress}`);
  }

  // Deploy DSNToken
  console.log("Deploying DSNToken...");
  const DSNToken = await ethers.getContractFactory("DSNToken", wallet);
  const dsnToken = await DSNToken.deploy(wallet.address);
  await dsnToken.waitForDeployment();
  const dsnTokenAddress = await dsnToken.getAddress();
  console.log(`DSNToken deployed to: ${dsnTokenAddress}`);

  // Deploy TokenProxy
  console.log("Deploying TokenProxy...");
  const TokenProxy = await ethers.getContractFactory("TokenProxy", wallet);
  const tokenProxy = await TokenProxy.deploy(forwarderAddress);
  await tokenProxy.waitForDeployment();
  const tokenProxyAddress = await tokenProxy.getAddress();
  console.log(`TokenProxy deployed to: ${tokenProxyAddress}`);

  // Update .env file with new contract addresses
  const envPath = path.resolve(__dirname, "../.env");
  let envContent = "";
  
  try {
    envContent = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    console.log("No existing .env file found, creating new one");
  }

  // Update or add DSN_TOKEN_ADDRESS
  if (envContent.includes("DSN_TOKEN_ADDRESS=")) {
    envContent = envContent.replace(
      /DSN_TOKEN_ADDRESS=.*/,
      `DSN_TOKEN_ADDRESS=${dsnTokenAddress}`
    );
  } else {
    envContent += `\nDSN_TOKEN_ADDRESS=${dsnTokenAddress}`;
  }

  // Update or add TOKEN_PROXY_ADDRESS
  if (envContent.includes("TOKEN_PROXY_ADDRESS=")) {
    envContent = envContent.replace(
      /TOKEN_PROXY_ADDRESS=.*/,
      `TOKEN_PROXY_ADDRESS=${tokenProxyAddress}`
    );
  } else {
    envContent += `\nTOKEN_PROXY_ADDRESS=${tokenProxyAddress}`;
  }

  // Update or add FORWARDER_ADDRESS if it was newly deployed
  if (!process.env.FORWARDER_ADDRESS && envContent.includes("FORWARDER_ADDRESS=")) {
    envContent = envContent.replace(
      /FORWARDER_ADDRESS=.*/,
      `FORWARDER_ADDRESS=${forwarderAddress}`
    );
  } else if (!process.env.FORWARDER_ADDRESS) {
    envContent += `\nFORWARDER_ADDRESS=${forwarderAddress}`;
  }

  // Write updated content back to .env file
  fs.writeFileSync(envPath, envContent);
  console.log(".env file updated with deployed contract addresses");

  console.log("\nDeployment Summary:");
  console.log(`- MinimalForwarder: ${forwarderAddress}`);
  console.log(`- DSNToken: ${dsnTokenAddress}`);
  console.log(`- TokenProxy: ${tokenProxyAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
