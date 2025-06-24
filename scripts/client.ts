import { createWalletClient, http, parseEther, toHex, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const USER_PRIVATE_KEY = process.env.USER_PRIVATE_KEY;
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS;
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3000/relay';

if (!USER_PRIVATE_KEY) throw new Error('USER_PRIVATE_KEY is required in .env');
if (!FORWARDER_ADDRESS) throw new Error('FORWARDER_ADDRESS is required in .env');

// Initialize client
const account = privateKeyToAccount(USER_PRIVATE_KEY as `0x${string}`);

const walletClient = createWalletClient({
  account,
  chain: hardhat,
  transport: http(RPC_URL),
});

// Types
type ForwardRequest = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  data: `0x${string}`;
};

type RelayRequest = {
  request: ForwardRequest;
  signature: `0x${string}`;
};

// Get nonce from the forwarder
async function getNonce(forwarderAddress: `0x${string}`, from: `0x${string}`) {
  const data = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [
      {
        to: forwarderAddress,
        data: `0x2f54bf6e${from.slice(2).padStart(64, '0')}`,
      },
      'latest',
    ],
  };

  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  const result = await response.json();
  return BigInt(result.result);
}

// Sign and send meta-transaction
export async function sendMetaTransaction(
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = 0n,
  gas: bigint = 200000n
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const from = account.address;
    const nonce = await getNonce(FORWARDER_ADDRESS as `0x${string}`, from);

    // Create the forward request
    const request: ForwardRequest = {
      from,
      to,
      value,
      gas,
      nonce,
      data,
    };

    // Get the EIP-712 domain separator
    const domain = {
      name: 'MinimalForwarder',
      version: '0.0.1',
      chainId: hardhat.id,
      verifyingContract: FORWARDER_ADDRESS,
    };

    // The types for the EIP-712 message
    const types = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
    };

    // Sign the typed data
    const signature = await walletClient.signTypedData({
      domain,
      types,
      primaryType: 'ForwardRequest',
      message: request,
    });

    // Create the relay request
    const relayRequest: RelayRequest = {
      request,
      signature,
    };

    // Send to relayer
    const response = await axios.post(RELAYER_URL, relayRequest);
    
    return { success: true, txHash: response.data.transactionHash };
  } catch (error) {
    console.error('Error sending meta-transaction:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Example usage
async function exampleUsage() {
  // Replace with your TestToken address
  const tokenAddress = '0x...';
  
  // Encode the mintToSender function call
  const data = '0x1249c58b';
  
  // Send the meta-transaction
  const result = await sendMetaTransaction(tokenAddress, data as `0x${string}`);
  console.log('Meta-transaction result:', result);
}

// Run the example if this file is executed directly
if (require.main === module) {
  exampleUsage().catch(console.error);
}
