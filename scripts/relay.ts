import dotenv from 'dotenv';
import { ethers } from 'ethers';

// Types
export interface ForwardRequest {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  data: `0x${string}`;
}

export interface RelayRequest {
  request: ForwardRequest;
  signature: `0x${string}`;
}

interface RelayResult {
  success: boolean;
  transactionHash?: string;
  receipt?: any;
  error?: string;
}

dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY;
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS as `0x${string}`;

if (!SPONSOR_PRIVATE_KEY) throw new Error('SPONSOR_PRIVATE_KEY is required in .env');
if (!FORWARDER_ADDRESS) throw new Error('FORWARDER_ADDRESS is required in .env');

// Initialize provider and signer
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(SPONSOR_PRIVATE_KEY, provider);

// ABI for MinimalForwarder
const MINIMAL_FORWARDER_ABI = [
  'function verify((address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data), bytes signature) view returns (bool)',
  'function execute((address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data), bytes signature) payable returns (bool, bytes)'
];

// Main relay function
export async function relayMetaTransaction(
  relayRequest: RelayRequest
): Promise<RelayResult> {
  try {
    // Create contract instance
    const forwarder = new ethers.Contract(
      FORWARDER_ADDRESS,
      MINIMAL_FORWARDER_ABI,
      wallet
    );

    // Verify the signature
    const isValid = await forwarder.verify(
      {
        from: relayRequest.request.from,
        to: relayRequest.request.to,
        value: relayRequest.request.value,
        gas: relayRequest.request.gas,
        nonce: relayRequest.request.nonce,
        data: relayRequest.request.data
      },
      relayRequest.signature
    );
    
    if (!isValid) {
      return { success: false, error: 'Invalid signature' };
    }

    // Execute the meta-transaction
    const tx = await forwarder.execute(
      {
        from: relayRequest.request.from,
        to: relayRequest.request.to,
        value: relayRequest.request.value,
        gas: relayRequest.request.gas,
        nonce: relayRequest.request.nonce,
        data: relayRequest.request.data
      },
      relayRequest.signature,
      { value: relayRequest.request.value }
    );
    
    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    
    return {
      success: true,
      transactionHash: tx.hash,
      receipt: receipt
    };
    
  } catch (error) {
    console.error('Error relaying meta-transaction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Start the relayer server
if (require.main === module) {
  console.log('Starting meta-transaction relayer...');
  
  // This will be used when running this script directly
  // In a real-world scenario, you might want to use Express or similar
  console.log('Relayer ready to process meta-transactions');
}
