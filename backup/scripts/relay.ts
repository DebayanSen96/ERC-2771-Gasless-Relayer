import dotenv from 'dotenv';
import { ethers } from 'ethers';
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

// ---------------- Auto top-up config ----------------
// These env vars let ops tune behaviour without redeploying.
//   MIN_ETH_BALANCE_WEI  – if sender balance < this, top-up triggers
//   TOP_UP_AMOUNT_WEI    – how much ETH to send per top-up (fallback if estimation fails)
//   MAX_TOPUPS_PER_ADDRESS – safety cap per address (resets on relayer restart)
//   GAS_BUFFER_PERCENTAGE - buffer percentage to add to estimated gas costs
const MIN_ETH_BALANCE = BigInt(process.env.MIN_ETH_BALANCE_WEI || "1000000000000"); // 0.000001 ETH (1 microETH)
const TOP_UP_AMOUNT   = BigInt(process.env.TOP_UP_AMOUNT_WEI  || "50000000000000"); // 0.00005 ETH
const MAX_TOPUPS_PER_ADDRESS = Number(process.env.MAX_TOPUPS_PER_ADDRESS || 3);
const GAS_BUFFER_PERCENTAGE = Number(process.env.GAS_BUFFER_PERCENTAGE || 30); // 30% buffer by default

// In-memory top-up counter (non-persistent – good enough for basic safety)
const topUpCounts: Record<string, number> = {};

const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY;
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS as `0x${string}`;

if (!SPONSOR_PRIVATE_KEY) throw new Error('SPONSOR_PRIVATE_KEY is required in .env');
if (!FORWARDER_ADDRESS) throw new Error('FORWARDER_ADDRESS is required in .env');

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(SPONSOR_PRIVATE_KEY, provider);

const EIP712_DOMAIN = {
  name: 'MinimalForwarder',
  version: '0.0.1',
  chainId: 84532, 
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

const MINIMAL_FORWARDER_ABI = [
  'function getNonce(address from) view returns (uint256)',
  'function verify((address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data), bytes signature) view returns (bool)',
  'function execute((address from, address to, uint256 value, uint256 gas, uint256 nonce, bytes data), bytes signature) payable returns (bool, bytes)'
];

export interface DirectApprovalRequest {
  privateKey: string; // Private key of the sender (unfunded wallet)
  tokenAddress: string; // ERC20 token contract
  spender: string; // Address (e.g., TokenProxy) to approve
  amount: string; // Amount (as string) in wei
}

export async function directApproval(request: DirectApprovalRequest): Promise<RelayResult> {
  try {
    const fromWallet = new ethers.Wallet(request.privateKey, provider);
    const sender = fromWallet.address;

    // --- Low-balance auto top-up logic (same as approval path in relayMetaTransaction) ---
    const senderBal = await provider.getBalance(sender);
    if (senderBal < MIN_ETH_BALANCE) {
      const already = topUpCounts[sender] ?? 0;
      if (already < MAX_TOPUPS_PER_ADDRESS) {
        let estimatedTopUpAmount: bigint = MIN_ETH_BALANCE - senderBal;
        // Fallback 1 gwei safety
        if (estimatedTopUpAmount <= 0n) {
          estimatedTopUpAmount = 1_000_000_000n;
        }
        console.log(`Top-up (direct approval): sending ${ethers.formatEther(estimatedTopUpAmount)} ETH to ${sender}`);
        try {
          const topTx = await wallet.sendTransaction({ to: sender, value: estimatedTopUpAmount });
          await topTx.wait();
          topUpCounts[sender] = already + 1;
          console.log(`Top-up mined (${already + 1}/${MAX_TOPUPS_PER_ADDRESS}): ${topTx.hash}`);
        } catch (err) {
          console.error('Top-up failed:', err);
          return { success: false, error: 'Top-up failed' };
        }
      } else {
        console.warn(`Top-up limit reached for ${sender}`);
      }
    }

    // --- Send approval transaction ---
    const token = new ethers.Contract(
      request.tokenAddress,
      ["function approve(address spender,uint256 amount) external returns (bool)"],
      fromWallet
    );

    console.log(`Sending approval tx from ${sender} -> approve ${request.spender} for ${request.amount}`);
    const tx = await token.approve(request.spender, request.amount);
    const receipt = await tx.wait();
    console.log('Approval tx mined:', tx.hash);

    return { success: true, transactionHash: tx.hash, receipt };
  } catch (error) {
    console.error('directApproval error:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function relayMetaTransaction(
  relayRequest: RelayRequest
): Promise<RelayResult> {
  try {
    // -------- Low-balance auto top-up with gas estimation --------
    // Check if this is an ERC20 approval transaction
    const isApproval = relayRequest.request.data.startsWith('0x095ea7b3'); // approve function signature
    
    // Only perform top-up for approval transactions, not for meta-transactions
    // Meta-transactions are executed by the relayer, so sender doesn't need ETH
    if (isApproval) {
      const senderBal = await provider.getBalance(relayRequest.request.from);
      if (senderBal < MIN_ETH_BALANCE) {
        const already = topUpCounts[relayRequest.request.from] ?? 0;
        if (already < MAX_TOPUPS_PER_ADDRESS) {
          // Calculate the minimum top-up needed just to reach MIN_ETH_BALANCE
          const balanceShortfall = senderBal < MIN_ETH_BALANCE ? (MIN_ETH_BALANCE - senderBal) : BigInt(0);
          // We will increment this if additional gas is required (e.g. for approval tx)
          let estimatedTopUpAmount: bigint = balanceShortfall;
          
          try {
            // Get current gas price
            const feeData = await provider.getFeeData();
            const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
            if (maxFeePerGas) {
              // Typical ERC20 approval gas ~45k
              const approvalGas = BigInt(45000);
              const baseCost = approvalGas * maxFeePerGas;
              const buffer = (baseCost * BigInt(GAS_BUFFER_PERCENTAGE)) / BigInt(100);
              const gasTopUp = baseCost + buffer;
              // Choose the larger of gasTopUp or balance shortfall
              if (gasTopUp > estimatedTopUpAmount) {
                estimatedTopUpAmount = gasTopUp;
              }
              console.log(`Estimated approval cost: ${ethers.formatEther(baseCost)} ETH + ${GAS_BUFFER_PERCENTAGE}% buffer`);
            }
          } catch (err: unknown) {
            console.warn('Error during gas estimation – falling back to minimum shortfall only:', err instanceof Error ? err.message : String(err));
          }
          // Make sure we still top-up at least the balance short-fall
          if (estimatedTopUpAmount < balanceShortfall) {
            estimatedTopUpAmount = balanceShortfall;
          }
          // If, for some reason, the amount is still zero, default to a very small safety top-up (1 gwei)
          if (estimatedTopUpAmount === BigInt(0)) {
            estimatedTopUpAmount = BigInt(1_000_000_000); // 1 gwei
          }
          console.log(`Top-up: sending ${ethers.formatEther(estimatedTopUpAmount)} ETH to ${relayRequest.request.from}`);
          
          try {
            const topTx = await wallet.sendTransaction({ 
              to: relayRequest.request.from, 
              value: estimatedTopUpAmount 
            });
            await topTx.wait();
            topUpCounts[relayRequest.request.from] = already + 1;
            console.log(`Top-up mined (${already + 1}/${MAX_TOPUPS_PER_ADDRESS}): ${topTx.hash}`);
          } catch (fundErr) {
            console.error('Top-up failed:', fundErr);
          }
        } else {
          console.warn(`Top-up limit reached for ${relayRequest.request.from}`);
        }
      }
    } // End of approval transaction handling

    const forwarder = new ethers.Contract(
      FORWARDER_ADDRESS,
      MINIMAL_FORWARDER_ABI,
      wallet
    );

    const currentNonce = await forwarder.getNonce(relayRequest.request.from);
    
    if (BigInt(relayRequest.request.nonce) !== currentNonce) {
      return { 
        success: false, 
        error: `Invalid nonce. Expected: ${currentNonce}, got: ${relayRequest.request.nonce}` 
      };
    }
    
    const request = {
      from: relayRequest.request.from,
      to: relayRequest.request.to,
      value: BigInt(relayRequest.request.value),
      gas: BigInt(relayRequest.request.gas),
      nonce: BigInt(relayRequest.request.nonce),
      data: relayRequest.request.data as `0x${string}`
    };
    
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


if (require.main === module) {
  console.log('Starting meta-transaction relayer...');
  

  console.log('Relayer ready to process meta-transactions');
}
