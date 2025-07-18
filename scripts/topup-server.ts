import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables
const RPC_URL = process.env.RPC_URL || 'https://sepolia.base.org';
const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY;

if (!SPONSOR_PRIVATE_KEY) throw new Error('SPONSOR_PRIVATE_KEY is required in .env');

// Configure provider and wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(SPONSOR_PRIVATE_KEY, provider);

// In-memory top-up counter (non-persistent – good enough for basic safety)
const topUpCounts: Record<string, number> = {};
const MAX_TOPUPS_PER_ADDRESS = Number(process.env.MAX_TOPUPS_PER_ADDRESS || 3);
const GAS_BUFFER_PERCENTAGE = Number(process.env.GAS_BUFFER_PERCENTAGE || 30); // 30% buffer by default

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (_req: Request, res: Response): void => {
  res.json({ 
    status: 'ok', 
    message: 'ETH top-up service is running',
    network: process.env.NODE_ENV || 'development'
  });
});

// Top-up endpoint
interface TxPayload { to: string; data: string; value?: string; }
interface TopUpRequest { address: string; tx: TxPayload; signature: string; }

app.post('/topup', async (req: Request, res: Response) => {
  console.log('Received top-up request:', JSON.stringify(req.body, null, 2));
  
  try {
    const { address, tx, signature } = req.body as TopUpRequest;
    
    if (!ethers.isAddress(address) || !tx || !ethers.isAddress(tx.to)) {
      res.status(400).json({ success: false, error: 'Invalid parameters' });
      return;
    }
    const message = ethers.solidityPacked(['address','address','bytes','uint256'],[address,tx.to,tx.data ?? '0x',BigInt(tx.value ?? '0')]);
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      res.status(400).json({ success: false, error: 'Invalid signature' });
      return;
    }

    // Check if address has reached top-up limit
    const already = topUpCounts[address] ?? 0;
    if (already >= MAX_TOPUPS_PER_ADDRESS) {
      res.status(429).json({ 
        success: false, 
        error: `Top-up limit reached for ${address} (${already}/${MAX_TOPUPS_PER_ADDRESS})` 
      });
      return;
    }

    const currentBalance = await provider.getBalance(address);
    const gasUnits = await provider.estimateGas({to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined});
    const price = (await provider.getFeeData()).gasPrice ?? BigInt(1000000000);
    let estimatedTopUpAmount = gasUnits * price;
    const buffer = (estimatedTopUpAmount * BigInt(GAS_BUFFER_PERCENTAGE)) / BigInt(100);
    estimatedTopUpAmount += buffer;
    
    // For native ETH transfers, we need to include the transfer amount in the required balance
    // For ERC20 transfers, we only need to cover gas
    const isNativeTransfer = !tx.data || tx.data === '0x' || tx.data === '0x0';
    const txValue = tx.value ? BigInt(tx.value) : 0n;
    let requiredBalance: bigint;
    if (isNativeTransfer) {
      if (currentBalance < txValue) {
        res.status(400).json({ success: false, error: 'Sender balance below transfer value' });
        return;
      }
      requiredBalance = estimatedTopUpAmount;
    } else {
      requiredBalance = estimatedTopUpAmount;
    }
      
    // Always send the estimated gas fees + buffer to ensure gasless experience
    // This covers the case where the user has some ETH but we still want to sponsor the transaction
    const neededAmount = estimatedTopUpAmount;
    
    console.log(`Top-up: sending ${ethers.formatEther(neededAmount)} ETH to ${address}`);
    
    // Send the transaction
    const topTx = await wallet.sendTransaction({ 
      to: address, 
      value: neededAmount 
    });
    
    // Update top-up counter
    topUpCounts[address] = already + 1;
    
    console.log(`Top-up initiated (${already + 1}/${MAX_TOPUPS_PER_ADDRESS}): ${topTx.hash}`);
    
    // Wait for transaction to be mined
    const receipt = await topTx.wait();
    res.json({
      success: true,
      transactionHash: topTx.hash,
      receipt: receipt,
      amountSent: neededAmount.toString(),
      topUpsRemaining: MAX_TOPUPS_PER_ADDRESS - (already + 1)
    });
    
  } catch (error) {
    console.error('Error processing top-up request:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start the server
const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Top-up server running on http://localhost:${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default server;
