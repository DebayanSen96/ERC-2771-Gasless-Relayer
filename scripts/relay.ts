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

// EIP-712 types for the MinimalForwarder
const EIP712_DOMAIN = {
  name: 'MinimalForwarder',
  version: '0.0.1',
  chainId: 84532, // Base Sepolia chain ID
  verifyingContract: process.env.FORWARDER_ADDRESS as `0x${string}`,
};

const FORWARD_REQUEST_TYPE = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
};

// ABI for MinimalForwarder
const MINIMAL_FORWARDER_ABI = [
  'function getNonce(address from) view returns (uint256)',
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

    // Get current nonce from the forwarder
    const currentNonce = await forwarder.getNonce(relayRequest.request.from);
    
    // Verify the nonce
    if (BigInt(relayRequest.request.nonce) !== currentNonce) {
      return { 
        success: false, 
        error: `Invalid nonce. Expected: ${currentNonce}, got: ${relayRequest.request.nonce}` 
      };
    }
    
    // Reconstruct the original request with BigInt values
    const request = {
      from: relayRequest.request.from,
      to: relayRequest.request.to,
      value: BigInt(relayRequest.request.value),
      gas: BigInt(relayRequest.request.gas),
      nonce: BigInt(relayRequest.request.nonce),
      data: relayRequest.request.data as `0x${string}`
    };
    
    // Verify the signature using EIP-712
    try {
      const recovered = await ethers.verifyTypedData(
        EIP712_DOMAIN,
        FORWARD_REQUEST_TYPE,
        request,
        relayRequest.signature
      );
      
      if (recovered.toLowerCase() !== request.from.toLowerCase()) {
        return { success: false, error: 'Invalid signature: recovered address does not match from address' };
      }
    } catch (error) {
      console.error('Signature verification failed:', error);
      return { success: false, error: 'Signature verification failed' };
    }

    // Execute the meta-transaction
    console.log('Executing meta-transaction:', {
      from: request.from,
      to: request.to,
      value: request.value.toString(),
      gas: request.gas.toString(),
      nonce: request.nonce.toString(),
      data: request.data
    });
    
    const tx = await forwarder.execute(
      request,
      relayRequest.signature,
      { value: request.value }
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
