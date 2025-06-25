import { ethers } from "hardhat";
import { createPublicClient, http, createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";
import { TypedDataDomain } from "ethers";
import axios from "axios";

// Load environment variables
dotenv.config();

// Contract ABIs
const MinimalForwarderABI = [
  "function getNonce(address from) view returns (uint256)",
  "function verify(tuple(address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data) req, bytes signature) view returns (bool)"
];

const TokenProxyABI = [
  "function mintToken(address token, uint256 amount) external",
  "function getCurrentSender() external view returns (address)"
];

const DSNTokenABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function publicMint(uint256 amount) external"
];

// EIP-712 domain for MinimalForwarder
const EIP712Domain = {
  name: "MinimalForwarder",
  version: "0.0.1",
  chainId: 84532, // Base Sepolia
  verifyingContract: ""
};

// ForwardRequest type for EIP-712 signing
const ForwardRequest = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "data", type: "bytes" }
];

async function main() {
  console.log("Testing gasless minting via TokenProxy...");

  // Get addresses from .env
  const forwarderAddress = process.env.FORWARDER_ADDRESS;
  const dsnTokenAddress = process.env.DSN_TOKEN_ADDRESS;
  const tokenProxyAddress = process.env.TOKEN_PROXY_ADDRESS;
  const rpcUrl = process.env.RPC_URL || "https://sepolia.base.org";
  const relayerUrl = process.env.RELAYER_URL || "http://localhost:3000";

  if (!forwarderAddress || !dsnTokenAddress || !tokenProxyAddress) {
    throw new Error("Missing contract addresses in .env file");
  }

  // Update EIP712Domain with the actual forwarder address
  EIP712Domain.verifyingContract = forwarderAddress;

  // Create unfunded wallet (with no ETH for gas)
  const unfundedPrivateKey = process.env.PRIVATE_KEY_UNFUNDED;
  if (!unfundedPrivateKey) {
    throw new Error("PRIVATE_KEY_UNFUNDED not found in .env file");
  }

  // Create provider and wallet
  const provider = ethers.provider;
  const unfundedWallet = new ethers.Wallet(unfundedPrivateKey, provider);
  console.log(`Unfunded wallet address: ${unfundedWallet.address}`);

  // Check ETH balance to confirm it's unfunded
  const ethBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`Unfunded wallet ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
  
  // Check initial DSN token balance
  const dsnToken = new ethers.Contract(dsnTokenAddress, DSNTokenABI, provider);
  const initialBalance = await dsnToken.balanceOf(unfundedWallet.address);
  console.log(`Initial DSN token balance: ${ethers.formatEther(initialBalance)} DSN`);

  // Create viem public client for Base Sepolia
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl)
  });

  // Create viem wallet client for the unfunded wallet
  const walletClient = createWalletClient({
    account: unfundedWallet.address as `0x${string}`,
    chain: baseSepolia,
    transport: http(rpcUrl)
  });

  // Connect to MinimalForwarder contract
  const forwarder = new ethers.Contract(forwarderAddress, MinimalForwarderABI, provider);

  // Get the current nonce for the unfunded wallet
  const nonce = await forwarder.getNonce(unfundedWallet.address);
  console.log(`Current nonce: ${nonce}`);

  // Amount to mint (1000 tokens with 18 decimals)
  const mintAmount = ethers.parseEther("1000");

  // Encode the mintToken function call
  // mintToken(address token, uint256 amount)
  const tokenProxy = new ethers.Contract(tokenProxyAddress, TokenProxyABI, provider);
  const data = tokenProxy.interface.encodeFunctionData("mintToken", [
    dsnTokenAddress,
    mintAmount
  ]);

  // Create the forward request
  const request = {
    from: unfundedWallet.address,
    to: tokenProxyAddress,
    value: 0,
    gas: 500000,
    nonce: Number(nonce),
    data
  };

  console.log("Creating meta-transaction request:", request);

  // Sign the forward request with EIP-712
  const signature = await unfundedWallet.signTypedData(
    EIP712Domain as TypedDataDomain,
    { ForwardRequest },
    request
  );

  console.log("Generated signature:", signature);

  // Verify the signature (optional, for debugging)
  const isValid = await forwarder.verify(request, signature);
  console.log(`Signature verification: ${isValid ? "Valid" : "Invalid"}`);

  if (!isValid) {
    throw new Error("Invalid signature");
  }

  // Send the request to the relayer
  console.log(`Sending meta-transaction to relayer at ${relayerUrl}/relay`);
  console.log('Request payload:', JSON.stringify({
    request: {
      from: request.from,
      to: request.to,
      value: request.value.toString(),
      gas: request.gas.toString(),
      nonce: request.nonce.toString(),
      data: request.data
    },
    signature
  }, null, 2));
  try {
    const response = await axios.post(`${relayerUrl}/relay`, {
      request: {
        from: request.from,
        to: request.to,
        value: request.value.toString(),
        gas: request.gas.toString(),
        nonce: request.nonce.toString(),
        data: request.data
      },
      signature
    });

    console.log("Relayer response:", response.data);

    // Wait a few seconds for the transaction to be mined
    console.log("Waiting for transaction to be mined...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check final DSN token balance
    const finalBalance = await dsnToken.balanceOf(unfundedWallet.address);
    console.log(`Final DSN token balance: ${ethers.formatEther(finalBalance)} DSN`);

    // Calculate and display the difference
    const balanceDiff = finalBalance - initialBalance;
    console.log(`Balance change: ${ethers.formatEther(balanceDiff)} DSN`);

    if (balanceDiff > 0) {
      console.log("✅ Gasless minting successful!");
    } else {
      console.log("❌ Minting did not increase token balance");
    }
  } catch (error: any) {
    console.error("Error sending meta-transaction:", error);
    if (error.response) {
      console.error("Response data:", error.response.data);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
