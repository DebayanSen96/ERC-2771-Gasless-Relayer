import { ethers } from "hardhat";
import { TypedDataDomain } from "ethers";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const MinimalForwarderABI = [
  "function getNonce(address from) view returns (uint256)",
  "function verify(tuple(address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data) req, bytes signature) view returns (bool)"
];

const TokenProxyABI = [
  "function mintToken(address token, uint256 amount) external",
  "function transferToken(address token, address to, uint256 amount) external returns (bool)",
  "function getCurrentSender() external view returns (address)"
];

const DSNTokenABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)"
];

const EIP712Domain = {
  name: "MinimalForwarder",
  version: "0.0.1",
  chainId: 84532, // Base Sepolia
  verifyingContract: ""
};

const ForwardRequest = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "data", type: "bytes" }
];

async function main() {
  console.log("Testing complete ERC-2771 flow with auto top-up...");

  const forwarderAddress = process.env.FORWARDER_ADDRESS;
  const dsnTokenAddress = process.env.DSN_TOKEN_ADDRESS;
  const tokenProxyAddress = process.env.TOKEN_PROXY_ADDRESS;
  const rpcUrl = process.env.RPC_URL || "https://sepolia.base.org";
  const relayerUrl = process.env.RELAYER_URL || "http://localhost:3000";

  if (!forwarderAddress || !dsnTokenAddress || !tokenProxyAddress) {
    throw new Error("Missing contract addresses in .env file");
  }

  EIP712Domain.verifyingContract = forwarderAddress;

  const unfundedPrivateKey = process.env.PRIVATE_KEY_UNFUNDED;
  if (!unfundedPrivateKey) {
    throw new Error("PRIVATE_KEY_UNFUNDED not found in .env file");
  }

  const fundedWalletAddress = process.env.FUNDED_WALLET_ADDRESS || "0x578636C1CDfd5BCA3F1e787Fa49c2ea664c7bd8C";

  const provider = ethers.provider;
  const unfundedWallet = new ethers.Wallet(unfundedPrivateKey, provider);
  console.log(`Unfunded wallet address: ${unfundedWallet.address}`);
  console.log(`Funded wallet address (recipient): ${fundedWalletAddress}`);

  const initialEthBalance = await provider.getBalance(unfundedWallet.address);
  console.log(`Initial ETH balance: ${ethers.formatEther(initialEthBalance)} ETH`);
  
  const dsnToken = new ethers.Contract(dsnTokenAddress, DSNTokenABI, provider);
  const initialSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
  const initialRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
  console.log(`Initial sender DSN balance: ${ethers.formatEther(initialSenderBalance)} DSN`);
  console.log(`Initial recipient DSN balance: ${ethers.formatEther(initialRecipientBalance)} DSN`);

  const transferAmount = ethers.parseEther("10");

  if (initialSenderBalance < transferAmount) {
    throw new Error(`Insufficient DSN balance. Have ${ethers.formatEther(initialSenderBalance)}, need ${ethers.formatEther(transferAmount)}`);
  }

  console.log("\n=== PART 1: Direct ERC20 approval with auto top-up ===");
  
  const signer = unfundedWallet.connect(provider);
  const dsnTokenWithSigner = dsnToken.connect(signer);
  
  try {
    console.log(`\nChecking current allowance...`);
    const currentAllowance = await dsnToken.allowance(unfundedWallet.address, tokenProxyAddress);
    console.log(`Current allowance: ${ethers.formatEther(currentAllowance)} DSN`);

    if (currentAllowance < transferAmount) {
      console.log(`\nApproving TokenProxy to spend ${ethers.formatEther(transferAmount)} DSN tokens...`);
      const approveTx = await dsnTokenWithSigner.approve(tokenProxyAddress, transferAmount);
      console.log(`Approval transaction hash: ${approveTx.hash}`);
      console.log("Waiting for approval transaction to be mined...");
      
      const approveReceipt = await approveTx.wait();
      console.log(`Approval confirmed in block ${approveReceipt.blockNumber}`);
      
      const newAllowance = await dsnToken.allowance(unfundedWallet.address, tokenProxyAddress);
      console.log(`New allowance: ${ethers.formatEther(newAllowance)} DSN`);
    } else {
      console.log(`Sufficient allowance already exists. Skipping approval step.`);
    }

    const midEthBalance = await provider.getBalance(unfundedWallet.address);
    console.log(`ETH balance after approval: ${ethers.formatEther(midEthBalance)} ETH`);
    console.log(`ETH used for approval: ${ethers.formatEther(initialEthBalance - midEthBalance)} ETH`);
  } catch (error) {
    console.error("Error during approval:", error);
    return;
  }

  console.log("\n=== PART 2: Gasless transfer via meta-transaction ===");

  try {
    const forwarder = new ethers.Contract(forwarderAddress, MinimalForwarderABI, provider);
    const nonce = await forwarder.getNonce(unfundedWallet.address);
    console.log(`Current nonce for transfer: ${nonce}`);

    const tokenProxy = new ethers.Contract(tokenProxyAddress, TokenProxyABI, provider);
    const transferData = tokenProxy.interface.encodeFunctionData("transferToken", [
      dsnTokenAddress,
      fundedWalletAddress,
      transferAmount
    ]);

    const request = {
      from: unfundedWallet.address,
      to: tokenProxyAddress,
      value: 0,
      gas: 500000,
      nonce: Number(nonce),
      data: transferData
    };

    console.log("Creating meta-transaction request:", request);

    const signature = await unfundedWallet.signTypedData(
      EIP712Domain as TypedDataDomain,
      { ForwardRequest },
      request
    );

    console.log("Generated signature:", signature);

    const isValid = await forwarder.verify(request, signature);
    console.log(`Signature verification: ${isValid ? "Valid" : "Invalid"}`);

    if (!isValid) {
      throw new Error("Invalid signature");
    }

    console.log(`Sending meta-transaction to relayer at ${relayerUrl}/relay`);
    
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

    console.log("Waiting for transaction to be mined...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    const finalEthBalance = await provider.getBalance(unfundedWallet.address);
    const finalSenderBalance = await dsnToken.balanceOf(unfundedWallet.address);
    const finalRecipientBalance = await dsnToken.balanceOf(fundedWalletAddress);
    
    console.log(`\nFinal ETH balance: ${ethers.formatEther(finalEthBalance)} ETH`);
    console.log(`Final sender DSN balance: ${ethers.formatEther(finalSenderBalance)} DSN`);
    console.log(`Final recipient DSN balance: ${ethers.formatEther(finalRecipientBalance)} DSN`);
    
    const ethBalanceDiff = finalEthBalance - initialEthBalance;
    const senderBalanceDiff = finalSenderBalance - initialSenderBalance;
    const recipientBalanceDiff = finalRecipientBalance - initialRecipientBalance;
    
    console.log(`\nTotal ETH balance change: ${ethers.formatEther(ethBalanceDiff)} ETH`);
    console.log(`Sender DSN balance change: ${ethers.formatEther(senderBalanceDiff)} DSN`);
    console.log(`Recipient DSN balance change: ${ethers.formatEther(recipientBalanceDiff)} DSN`);
    
    if (recipientBalanceDiff > 0) {
      console.log("\n✅ Complete flow successful!");
      console.log(`The relayer topped up the sender with ETH for the approval, and then handled the gasless transfer via meta-transaction.`);
    } else {
      console.log("\n❌ Token transfer did not increase recipient balance");
    }
  } catch (error) {
    console.error("Error during meta-transaction:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
