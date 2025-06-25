import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { relayMetaTransaction, RelayRequest } from './relay';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response): void => {
  res.json({ 
    status: 'ok', 
    message: 'Meta-transaction relayer is running',
    network: process.env.NODE_ENV || 'development'
  });
});

const relayHandler = async (req: Request<{}, {}, RelayRequest>, res: Response): Promise<void> => {
  console.log('Received relay request:', JSON.stringify(req.body, null, 2));
  
  try {
    if (!req.body || !req.body.request || !req.body.signature) {
      const response = {
        success: false as const,
        error: 'Invalid request format. Expected { request: ForwardRequest, signature: string }' as const
      };
      res.status(400).json(response);
      return;
    }

    // Process the meta-transaction
    const result = await relayMetaTransaction(req.body);
    
    // Handle the result
    if (result.success && result.transactionHash) {
      console.log('Relay successful. Transaction hash:', result.transactionHash);
      const response = {
        success: true as const,
        transactionHash: result.transactionHash,
        receipt: result.receipt
      };
      res.json(response);
      return;
    } else {
      console.error('Relay failed:', result.error);
      const response = {
        success: false as const,
        error: result.error || 'Unknown error occurred while relaying transaction' as const
      };
      res.status(400).json(response);
      return;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in /relay endpoint:', error);
    
    const response = {
      success: false as const,
      error: 'Internal server error' as const,
      details: errorMessage
    };
    res.status(500).json(response);
    return;
  }
};

// Register the route handler
app.post('/relay', (req, res) => {
  relayHandler(req, res).catch(err => {
    console.error('Unhandled error in relay handler:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: Function) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start the server
const server = app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Relayer server running on http://localhost:${PORT}`);
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
