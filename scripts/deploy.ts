import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

async function deployContract(contractName: string, args: any[] = []) {
  const Contract = await ethers.getContractFactory(contractName);
  const contract = await Contract.deploy(...args);
  await contract.deployed();
  return contract;
}

export default async function (hre: HardhatRuntimeEnvironment) {
  const { network } = hre;
  const [deployer] = await ethers.getSigners();

  console.log(`Deploying contracts to ${network.name} with account ${deployer.address}`);
  console.log(`Account balance: ${(await deployer.getBalance()).toString()}`);

  try {
    // Deploy MinimalForwarder
    console.log("Deploying MinimalForwarder...");
    const forwarder = await deployContract("MinimalForwarder", []);
    console.log(`MinimalForwarder deployed to: ${forwarder.address}`);

    // Deploy TestToken with MinimalForwarder address
    console.log("Deploying TestToken...");
    const token = await deployContract("TestToken", [forwarder.address]);
    console.log(`TestToken deployed to: ${token.address}`);

    // Save deployment addresses
    console.log("\n=== Deployment Summary ===");
    console.log(`Network: ${network.name} (Chain ID: ${network.config.chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    console.log(`MinimalForwarder: ${forwarder.address}`);
    console.log(`TestToken: ${token.address}`);

    // Verify on block explorer if on a live network
    if (network.name !== "hardhat" && network.name !== "localhost") {
      console.log("\nWaiting for block confirmations...");
      await forwarder.deployTransaction.wait(6);
      await token.deployTransaction.wait(6);

      console.log("\nVerifying contracts on block explorer...");
      await hre.run("verify:verify", {
        address: forwarder.address,
        constructorArguments: [],
      });

      await hre.run("verify:verify", {
        address: token.address,
        constructorArguments: [forwarder.address],
      });
    }

    return {
      forwarder: forwarder.address,
      token: token.address,
    };
  } catch (error) {
    console.error("Error during deployment:", error);
    process.exit(1);
  }
}
