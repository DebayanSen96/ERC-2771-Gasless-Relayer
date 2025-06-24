import { ethers, run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contract } from "ethers";

interface ContractDeployment {
  address: string;
  deploymentTransaction: () => Promise<{
    hash: string;
    wait: (confirmations?: number) => Promise<any>;
  }>;
}

async function deployContract(contractName: string, args: any[] = []) {
  console.log(`\nPreparing to deploy ${contractName}...`);
  const Contract = await ethers.getContractFactory(contractName);
  
  // Log deployment details
  console.log(`Deploying ${contractName} with args:`, JSON.stringify(args, (_, v) => 
    typeof v === 'bigint' ? v.toString() : v
  ));
  
  // Deploy the contract
  const contract = await Contract.deploy(...args);
  console.log(`Transaction hash: ${contract.deploymentTransaction()?.hash}`);
  
  // Wait for deployment to complete
  console.log(`Waiting for ${contractName} deployment...`);
  const deployed = await contract.waitForDeployment();
  const address = await deployed.getAddress();
  
  console.log(`${contractName} deployed to:`, address);
  
  // Get the deployment transaction
  const deployTx = contract.deploymentTransaction();
  if (!deployTx) {
    throw new Error('Deployment transaction not found');
  }
  
  return {
    address,
    deploymentTransaction: {
      hash: deployTx.hash,
      wait: (confirmations?: number) => deployTx.wait(confirmations)
    }
  };
}

// Helper function to wait for transaction confirmation
async function waitForTransaction(hash: string, confirmations = 1) {
  console.log(`Waiting for ${confirmations} confirmation(s) for tx: ${hash}`);
  
  // Get the transaction receipt
  const receipt = await ethers.provider.getTransactionReceipt(hash);
  
  if (!receipt) {
    // If no receipt yet, wait for it
    console.log(`Transaction ${hash} not yet mined, waiting for confirmations...`);
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    return waitForTransaction(hash, confirmations);
  }
  
  // If we already have enough confirmations, return
  const currentBlock = await ethers.provider.getBlockNumber();
  const confirmationsReceived = currentBlock - Number(receipt.blockNumber) + 1;
  
  if (confirmationsReceived >= confirmations) {
    console.log(`Transaction ${hash} has ${confirmationsReceived} confirmations`);
    return receipt;
  }
  
  // Otherwise, wait for more blocks
  const blocksToWait = confirmations - confirmationsReceived;
  console.log(`Waiting for ${blocksToWait} more block(s) for tx ${hash}...`);
  
  // Wait for the required number of blocks
  for (let i = 0; i < blocksToWait; i++) {
    await new Promise(resolve => 
      ethers.provider.once('block', resolve)
    );
  }
  
  return ethers.provider.getTransactionReceipt(hash);
}

async function verifyContract(address: string, constructorArguments: any[] = []) {
  console.log(`\nVerifying contract at ${address}...`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log(`Successfully verified contract at ${address}`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.toLowerCase().includes('already verified')) {
        console.log(`Contract at ${address} is already verified`);
      } else {
        console.error(`Error verifying contract at ${address}:`, error.message);
      }
    } else {
      console.error(`Unexpected error verifying contract at ${address}:`, error);
    }
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const isLiveNetwork = network.chainId !== 31337; // 31337 is Hardhat's default chainId
  
  console.log('\n===== Deployment Starting =====');
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  
  // Get balance using provider.getBalance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance === 0n) {
    console.warn('WARNING: Deployer account has 0 ETH. Please fund the account and try again.');
    if (isLiveNetwork) {
      console.error('Cannot proceed with deployment on live network with 0 balance');
      process.exit(1);
    }
  }

  try {
    // Deploy MinimalForwarder
    console.log('\n===== Deploying MinimalForwarder =====');
    const forwarder = await deployContract("MinimalForwarder", []);
    
    // Deploy TestToken with MinimalForwarder address
    console.log('\n===== Deploying TestToken =====');
    const token = await deployContract("TestToken", [forwarder.address]);

    // Save deployment addresses
    console.log('\n===== Deployment Summary =====');
    console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`MinimalForwarder: ${forwarder.address}`);
    console.log(`TestToken: ${token.address}`);

    // Verify on block explorer if on a live network
    if (isLiveNetwork) {
      console.log("\n===== Verifying Contracts =====");
      
      // Wait for transactions to be mined
      console.log("\nWaiting for block confirmations...");
      await waitForTransaction(forwarder.deploymentTransaction.hash, 1);
      await waitForTransaction(token.deploymentTransaction.hash, 1);

      // Verify contracts
      await verifyContract(forwarder.address, []);
      await verifyContract(token.address, [forwarder.address]);
    }

    return {
      forwarder: forwarder.address,
      token: token.address,
    };
  } catch (error) {
    console.error("\n===== Deployment Failed =====");
    console.error("Error:", error instanceof Error ? error.message : error);
    
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Execute the deployment
main()
  .then(() => {
    console.log("\n===== Deployment Completed Successfully =====");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n===== Unhandled Error =====");
    console.error(error);
    process.exit(1);
  });
