import { ethers } from "ethers";
import { TypedDataDomain } from "ethers";
import * as dotenv from "dotenv";
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
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)"
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
  console.log("Testing FULLY gasless token transfer (zero ETH wallet)...");

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
  const provider = new ethers.JsonRpcProvider(rpcUrl);
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

  // Amount to transfer (10 tokens with 18 decimals)
  let transferAmount = ethers.parseEther("10");

  // Check if we have enough balance
  if (initialSenderBalance < transferAmount) {
    throw new Error(`Insufficient DSN balance. Have ${ethers.formatEther(initialSenderBalance)}, need ${ethers.formatEther(transferAmount)}`);
  }

  // Connect to MinimalForwarder contract
  const forwarder = new ethers.Contract(forwarderAddress, MinimalForwarderABI, provider);

  // Step 1: Check current allowance
  console.log(`\nStep 1: Checking current allowance...`);
  const currentAllowance = await dsnToken.allowance(unfundedWallet.address, tokenProxyAddress);
  console.log(`Current allowance: ${ethers.formatEther(currentAllowance)} DSN`);

  // If allowance is insufficient, request the relayer to perform a direct approval
  if (currentAllowance < transferAmount) {
    console.log(`\nStep 2: Requesting relay service to submit approval...`);

    try {
      const approvalResp = await axios.post(`${relayerUrl}/approve`, {
        privateKey: unfundedPrivateKey,
        tokenAddress: dsnTokenAddress,
        spender: tokenProxyAddress,
        amount: transferAmount.toString()
      });

      console.log("Approval relay response:", approvalResp.data);

      if (!approvalResp.data.success) {
        throw new Error(`Approval relay failed: ${approvalResp.data.error}`);
      }

      // Wait a few seconds for the transaction to be mined
      console.log("Waiting for approval transaction to be mined...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error: any) {
      console.error("Error requesting approval via relay:", error);
      if (error.response) {
        console.error("Response data:", error.response.data);
      }
      throw error;
    }

    // Re-check allowance
    const newAllowance = await dsnToken.allowance(unfundedWallet.address, tokenProxyAddress);
    console.log(`New allowance: ${ethers.formatEther(newAllowance)} DSN`);

    if (newAllowance < transferAmount) {
      console.log(`Warning: Allowance (${ethers.formatEther(newAllowance)} DSN) is less than transfer amount (${ethers.formatEther(transferAmount)} DSN). Adjusting.`);
      if (newAllowance === 0n) {
        throw new Error("Approval failed - allowance still zero");
      }
      transferAmount = newAllowance;
    }
  } else {
    console.log(`Sufficient allowance already exists. Skipping approval step.`);
  }

  // Step 3: Create and sign a meta-transaction to transfer tokens
  console.log(`\nStep 3: Creating meta-transaction to transfer ${ethers.formatEther(transferAmount)} DSN tokens...`);

  // Get the current nonce for the unfunded wallet (might have increased if we did an approval)
  const transferNonce = await forwarder.getNonce(unfundedWallet.address);
  console.log(`Current nonce for transfer: ${transferNonce}`);

  // Connect to TokenProxy contract
  const tokenProxy = new ethers.Contract(tokenProxyAddress, TokenProxyABI, provider);
  
  // Encode the transferToken function call
  // transferToken(address token, address to, uint256 amount)
  const transferData = tokenProxy.interface.encodeFunctionData("transferToken", [
    dsnTokenAddress,
    fundedWalletAddress,
    transferAmount
  ]);

  // Create the forward request for transfer
  const transferRequest = {
    from: unfundedWallet.address,
    to: tokenProxyAddress,
    value: 0,
    gas: 500000,
    nonce: Number(transferNonce),
    data: transferData
  };

  console.log("Creating transfer meta-transaction request:", transferRequest);

  // Sign the forward request with EIP-712
  const transferSignature = await unfundedWallet.signTypedData(
    EIP712Domain as TypedDataDomain,
    { ForwardRequest },
    transferRequest
  );

  console.log("Generated transfer signature:", transferSignature);

  // Verify the signature (optional, for debugging)
  const isTransferValid = await forwarder.verify(transferRequest, transferSignature);
  console.log(`Transfer signature verification: ${isTransferValid ? "Valid" : "Invalid"}`);

  if (!isTransferValid) {
    throw new Error("Invalid transfer signature");
  }

  // Step 4: Send the transfer meta-transaction to the relayer
  console.log(`\nStep 4: Sending transfer meta-transaction to relayer at ${relayerUrl}/relay`);
  
  try {
    const transferResponse = await axios.post(`${relayerUrl}/relay`, {
      request: {
        from: transferRequest.from,
        to: transferRequest.to,
        value: transferRequest.value.toString(),
        gas: transferRequest.gas.toString(),
        nonce: transferRequest.nonce.toString(),
        data: transferRequest.data
      },
      signature: transferSignature
    });

    console.log("Transfer relayer response:", transferResponse.data);

    if (!transferResponse.data.success) {
      throw new Error(`Transfer meta-transaction failed: ${transferResponse.data.error}`);
    }

    // Wait a few seconds for the transaction to be mined
    console.log("Waiting for transfer transaction to be mined...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 5: Check final DSN token balances
    console.log("\nStep 5: Checking final token balances...");
    const finalSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
    const finalRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
    
    console.log(`Final sender DSN balance: ${ethers.formatEther(finalSenderBalance)} DSN`);
    console.log(`Final recipient DSN balance: ${ethers.formatEther(finalRecipientBalance)} DSN`);

    // Calculate and display the differences
    const senderBalanceDiff = finalSenderBalance - initialSenderBalance;
    const recipientBalanceDiff = finalRecipientBalance - initialRecipientBalance;
    
    console.log(`\nSender balance change: ${ethers.formatEther(senderBalanceDiff)} DSN`);
    console.log(`Recipient balance change: ${ethers.formatEther(recipientBalanceDiff)} DSN`);

    // Check final ETH balance to confirm it's still unfunded or minimally funded
    const finalEthBalance = await provider.getBalance(unfundedWallet.address);
    console.log(`Final unfunded wallet ETH balance: ${ethers.formatEther(finalEthBalance)} ETH`);

    if (recipientBalanceDiff > 0) {
      console.log("\n✅ FULLY gasless token transfer successful!");
      console.log(`${ethers.formatEther(transferAmount)} DSN tokens were transferred from the unfunded wallet to the funded wallet without requiring gas from the sender.`);
    } else {
      console.log("\n❌ Token transfer did not increase recipient balance");
    }
  } catch (error: any) {
    console.error("Error sending transfer meta-transaction:", error);
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
