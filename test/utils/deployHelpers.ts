import { ethers } from "hardhat";

export async function deployContract(contractName: string, args: any[] = []) {
  const Contract = await ethers.getContractFactory(contractName);
  const contract = await Contract.deploy(...args);
  await contract.deployed();
  return contract;
}

export async function getContractAt(contractName: string, address: string) {
  return await ethers.getContractAt(contractName, address);
}
