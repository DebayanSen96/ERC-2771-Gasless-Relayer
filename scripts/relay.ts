import { createPublicClient, createWalletClient, http, parseEther, hexToSignature, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import dotenv from 'dotenv';
import { MinimalForwarder } from '../typechain-types';
import { getContractAt } from '../test/utils/deployHelpers';

dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY;
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS;

if (!SPONSOR_PRIVATE_KEY) throw new Error('SPONSOR_PRIVATE_KEY is required in .env');
if (!FORWARDER_ADDRESS) throw new Error('FORWARDER_ADDRESS is required in .env');

// Initialize clients
const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(RPC_URL),
});

const account = privateKeyToAccount(SPONSOR_PRIVATE_KEY as `0x${string}`);

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

// Main relay function
export async function relayMetaTransaction(relayRequest: RelayRequest) {
  try {
    // Get the forwarder contract
    const forwarder = await getContractAt('MinimalForwarder', FORWARDER_ADDRESS) as unknown as MinimalForwarder;
    
    // Verify the request
    const isValid = await forwarder.verify(
      {
        from: relayRequest.request.from,
        to: relayRequest.request.to,
        value: relayRequest.request.value,
        gas: relayRequest.request.gas,
        nonce: relayRequest.request.nonce,
        data: relayRequest.request.data,
      },
      relayRequest.signature
    );

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    // Execute the meta-transaction
    const hash = await walletClient.writeContract({
      address: FORWARDER_ADDRESS as `0x${string}`,
      abi: forwarder.interface.formatJson(),
      functionName: 'execute',
      args: [
        {
          from: relayRequest.request.from,
          to: relayRequest.request.to,
          value: relayRequest.request.value,
          gas: relayRequest.request.gas,
          nonce: relayRequest.request.nonce,
          data: relayRequest.request.data,
        },
        relayRequest.signature,
      ],
    });

    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { success: true, transactionHash: hash, receipt };
  } catch (error) {
    console.error('Error relaying transaction:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Start the relayer server
if (require.main === module) {
  console.log('Starting meta-transaction relayer...');
  
  // Example usage:
  // This would be called by your API endpoint
  // relayMetaTransaction(relayRequest).then(console.log).catch(console.error);
  
  console.log('Relayer is running. Send POST requests to /relay with signed meta-transactions.');
}
