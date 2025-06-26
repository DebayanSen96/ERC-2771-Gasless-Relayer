import { ethers } from "hardhat";
import { createPublicClient, http, createWalletClient } from "viem";
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
  "function transferToken(address token, address to, uint256 amount) external returns (bool)",
  "function getCurrentSender() external view returns (address)"
];

const DSNTokenABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
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
  console.log("Testing gasless token transfer via TokenProxy...");

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

  // Get funded wallet address
  const fundedWalletAddress = process.env.FUNDED_WALLET_ADDRESS || "0x578636C1CDfd5BCA3F1e787Fa49c2ea664c7bd8C";

  // Create provider and wallet
  const provider = ethers.provider;
  const unfundedWallet = new ethers.Wallet(unfundedPrivateKey, provider);
  console.log(`Unfunded wallet address: ${unfundedWallet.address}`);
  console.log(`Funded wallet address (recipient): ${fundedWalletAddress}`);

  // Check ETH balance to confirm it's unfunded
  const ethBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`Unfunded wallet ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
  
  // Connect to DSN token contract
  const dsnToken = new ethers.Contract(dsnTokenAddress, DSNTokenABI, provider);
  
  // Check initial DSN token balances
  const initialSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
  const initialRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
  console.log(`Initial sender DSN balance: ${ethers.formatEther(initialSenderBalance)} DSN`);
  console.log(`Initial recipient DSN balance: ${ethers.formatEther(initialRecipientBalance)} DSN`);

  // Amount to transfer (100 tokens with 18 decimals)
  const transferAmount = ethers.parseEther("100");

  // Check if we have enough balance
  if (initialSenderBalance < transferAmount) {
    throw new Error(`Insufficient DSN balance. Have ${ethers.formatEther(initialSenderBalance)}, need ${ethers.formatEther(transferAmount)}`);
  }

  // Step 1: Approve the TokenProxy to spend tokens
  console.log(`\nStep 1: Approving TokenProxy (${tokenProxyAddress}) to spend ${ethers.formatEther(transferAmount)} DSN tokens...`);
  
  // We need to sign this transaction with the unfunded wallet (requires gas)
  const unfundedSigner = new ethers.Wallet(unfundedPrivateKey, provider);
  const dsnTokenWithSigner = dsnToken.connect(unfundedSigner);
  
  try {
    const approveTx = await dsnTokenWithSigner.approve(tokenProxyAddress, transferAmount);
    console.log(`Approval transaction hash: ${approveTx.hash}`);
    console.log("Waiting for approval transaction to be mined...");
    await approveTx.wait();
    console.log("✅ Approval successful!");
  } catch (error: any) {
    console.error("Error approving tokens:", error.message);
    if (error.message.includes("insufficient funds")) {
      console.log("\n⚠️ The unfunded wallet needs a small amount of ETH to approve tokens.");
      console.log("This is a one-time requirement. After approval, transfers can be gasless.");
      console.log("Please send a small amount of ETH to the unfunded wallet and try again.");
    }
    process.exit(1);
  }

  // Step 2: Create and sign a meta-transaction to transfer tokens
  console.log(`\nStep 2: Creating meta-transaction to transfer ${ethers.formatEther(transferAmount)} DSN tokens...`);

  // Connect to MinimalForwarder contract
  const forwarder = new ethers.Contract(forwarderAddress, MinimalForwarderABI, provider);

  // Get the current nonce for the unfunded wallet
  const nonce = await forwarder.getNonce(unfundedWallet.address);
  console.log(`Current nonce: ${nonce}`);

  // Connect to TokenProxy contract
  const tokenProxy = new ethers.Contract(tokenProxyAddress, TokenProxyABI, provider);
  
  // Encode the transferToken function call
  // transferToken(address token, address to, uint256 amount)
  const data = tokenProxy.interface.encodeFunctionData("transferToken", [
    dsnTokenAddress,
    fundedWalletAddress,
    transferAmount
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

  // Step 3: Send the meta-transaction to the relayer
  console.log(`\nStep 3: Sending meta-transaction to relayer at ${relayerUrl}/relay`);
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

    // Step 4: Check final DSN token balances
    console.log("\nStep 4: Checking final token balances...");
    const finalSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
    const finalRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
    
    console.log(`Final sender DSN balance: ${ethers.formatEther(finalSenderBalance)} DSN`);
    console.log(`Final recipient DSN balance: ${ethers.formatEther(finalRecipientBalance)} DSN`);

    // Calculate and display the differences
    const senderBalanceDiff = finalSenderBalance - initialSenderBalance;
    const recipientBalanceDiff = finalRecipientBalance - initialRecipientBalance;
    
    console.log(`\nSender balance change: ${ethers.formatEther(senderBalanceDiff)} DSN`);
    console.log(`Recipient balance change: ${ethers.formatEther(recipientBalanceDiff)} DSN`);

    if (recipientBalanceDiff > 0) {
      console.log("\n✅ Gasless token transfer successful!");
      console.log(`${ethers.formatEther(transferAmount)} DSN tokens were transferred from the unfunded wallet to the funded wallet without requiring gas from the sender.`);
    } else {
      console.log("\n❌ Token transfer did not increase recipient balance");
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
