import { createWalletClient, http, parseEther, toHex, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();
//configurations!!
const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const USER_PRIVATE_KEY = process.env.PRIVATE_KEY_UNFUNDED;
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3000/relay';

if (!USER_PRIVATE_KEY) throw new Error('USER_PRIVATE_KEY is required in .env');
if (!FORWARDER_ADDRESS) throw new Error('FORWARDER_ADDRESS is required in .env');

const formattedPrivateKey = USER_PRIVATE_KEY.startsWith('0x') 
  ? USER_PRIVATE_KEY 
  : `0x${USER_PRIVATE_KEY}`;
const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);

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


async function getNonce(forwarderAddress: `0x${string}`, from: `0x${string}`): Promise<bigint> {
  try {
    // Function selector for getNonce(address)
    // keccak256("getNonce(address)") = 0x2d0335ab
    // Then pad the address to 32 bytes
    const functionSelector = '0x2d0335ab';
    const paddedAddress = from.slice(2).padStart(64, '0');
    const callData = `${functionSelector}${paddedAddress}`;
    
    const data = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          to: forwarderAddress,
          data: callData,
        },
        'latest',
      ],
    };

    console.log('Fetching nonce from forwarder...');
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed with status ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.result) {
      console.error('RPC response error:', result);
      throw new Error('Invalid RPC response format');
    }

    // Parse the hex string to a bigint
    const nonce = BigInt(result.result);
    console.log('Got nonce:', nonce.toString());
    return nonce;
  } catch (error) {
    console.error('Error in getNonce:', error);
    throw new Error(`Failed to get nonce: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Sign and send meta-transaction
export async function sendMetaTransaction(
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint = 0n,
  gas: bigint = 200000n
): Promise<{ success: boolean; txHash?: string; receipt?: any; error?: string }> {
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
    // Using Base Sepolia chain ID (84532)
    const domain = {
      name: 'MinimalForwarder',
      version: '0.0.1',
      chainId: 84532, // Base Sepolia chain ID
      verifyingContract: FORWARDER_ADDRESS as `0x${string}`,
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

    // Create the relay request with BigInt values converted to strings for JSON serialization
    const relayRequest = {
      request: {
        ...request,
        value: request.value.toString(),
        gas: request.gas.toString(),
        nonce: request.nonce.toString(),
      },
      signature,
    };

    console.log('Sending relay request:', JSON.stringify(relayRequest, null, 2));
    
    // Send to relayer
    const response = await axios.post(RELAYER_URL, relayRequest, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('Relayer response:', response.data);
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'Unknown error from relayer');
    }
    
    return { 
      success: true, 
      txHash: response.data.transactionHash,
      receipt: response.data.receipt 
    };
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
  if (!TOKEN_ADDRESS) {
    throw new Error('TOKEN_ADDRESS is not set in .env');
  }
  
  console.log('Sending meta-transaction to mint tokens...');
  console.log(`From: ${account.address}`);
  console.log(`To: ${TOKEN_ADDRESS}`);
  console.log(`Using relayer: ${RELAYER_URL}`);
  
  const data: `0x${string}` = '0xe48e6227';
  
  console.log('Sending meta-transaction with data:', data);
  
  const result = await sendMetaTransaction(
    TOKEN_ADDRESS as `0x${string}`, 
    data as `0x${string}`,
    0n, // value
    200000n // gas
  );
  
  console.log('Meta-transaction result:', result);
  return result;
}

if (require.main === module) {
  exampleUsage().catch(console.error);
}
