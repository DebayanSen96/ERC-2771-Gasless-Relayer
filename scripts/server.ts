import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { relayMetaTransaction } from './relay';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Meta-transaction relayer is running' });
});

// Relay meta-transaction
app.post('/relay', async (req, res) => {
  try {
    const result = await relayMetaTransaction(req.body);
    if (result.success) {
      return res.json({ 
        success: true, 
        transactionHash: result.transactionHash,
        receipt: result.receipt
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }
  } catch (error) {
    console.error('Error in /relay endpoint:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Relayer server running on http://localhost:${PORT}`);
});
