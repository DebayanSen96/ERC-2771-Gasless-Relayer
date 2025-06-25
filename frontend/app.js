import { createWalletClient, http, parseEther, formatEther, encodeFunctionData } from 'https://esm.sh/viem@2.x';
import { privateKeyToAccount } from 'https://esm.sh/viem@2.x/accounts';

// DOM elements
const senderAddressEl = document.getElementById('sender-address');
const senderBalanceEl = document.getElementById('sender-balance');
const recipientAddressEl = document.getElementById('recipient-address');
const recipientBalanceEl = document.getElementById('recipient-balance');
const amountInput = document.getElementById('amount');
const transferBtn = document.getElementById('transfer-btn');
const statusEl = document.getElementById('status');

// Configuration - these would normally come from .env
// For demo purposes, we'll hardcode them here
const RPC_URL = 'https://sepolia.base.org';
const RELAYER_URL = 'http://localhost:3000/relay';
const TOKEN_ADDRESS = '0x046fA5D44953673294Bc97F5ACbF346Be544a3Fe';
const FORWARDER_ADDRESS = '0x9a42dc931963A42750B344a56fAd5e3B7A276595';

// This is the unfunded wallet's private key - NEVER expose this in production!
// For a real app, you would use a wallet connection like MetaMask
const UNFUNDED_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Initialize account and client
const account = privateKeyToAccount(UNFUNDED_PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  transport: http(RPC_URL),
});

// ERC20 ABI fragments
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: 'success', type: 'bool' }]
  }
];

// Initialize
async function init() {
  // Display sender address
  senderAddressEl.textContent = account.address;
  
  // Display recipient address
  const recipientAddress = recipientAddressEl.textContent;
  
  // Fetch balances
  await updateBalances();
  
  // Add event listener
  transferBtn.addEventListener('click', handleTransfer);
}

// Get nonce from the forwarder
async function getNonce(from) {
  try {
    // Function selector for getNonce(address)
    const functionSelector = '0x2d0335ab';
    const paddedAddress = from.slice(2).padStart(64, '0');
    const callData = `${functionSelector}${paddedAddress}`;
    
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: FORWARDER_ADDRESS,
            data: callData,
          },
          'latest',
        ],
      }),
    });

    const result = await response.json();
    
    if (!result.result) {
      throw new Error('Invalid RPC response format');
    }

    // Parse the hex string to a bigint
    return BigInt(result.result);
  } catch (error) {
    console.error('Error in getNonce:', error);
    throw new Error(`Failed to get nonce: ${error.message}`);
  }
}

// Update balances
async function updateBalances() {
  try {
    const senderAddress = account.address;
    const recipientAddress = recipientAddressEl.textContent;
    
    // Fetch sender balance
    const senderBalanceHex = await fetchBalance(senderAddress);
    const senderBalance = formatEther(BigInt(senderBalanceHex));
    senderBalanceEl.textContent = senderBalance;
    
    // Fetch recipient balance
    const recipientBalanceHex = await fetchBalance(recipientAddress);
    const recipientBalance = formatEther(BigInt(recipientBalanceHex));
    recipientBalanceEl.textContent = recipientBalance;
  } catch (error) {
    console.error('Error updating balances:', error);
    showStatus('Error fetching balances: ' + error.message, false);
  }
}

// Fetch balance of an address
async function fetchBalance(address) {
  // Encode the balanceOf function call
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address]
  });
  
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          to: TOKEN_ADDRESS,
          data,
        },
        'latest',
      ],
    }),
  });

  const result = await response.json();
  
  if (!result.result) {
    throw new Error('Invalid RPC response format');
  }
  
  return result.result;
}

// Handle transfer button click
async function handleTransfer() {
  try {
    const amount = amountInput.value;
    if (!amount || amount <= 0) {
      throw new Error('Please enter a valid amount');
    }
    
    const recipientAddress = recipientAddressEl.textContent;
    
    // Show loading status
    showStatus('Processing transfer...', true);
    transferBtn.disabled = true;
    
    // Convert amount to wei (18 decimals)
    const amountWei = parseEther(amount);
    
    // Send meta-transaction
    const result = await sendMetaTransaction(
      recipientAddress,
      amountWei
    );
    
    if (result.success) {
      showStatus(`Transfer successful! Transaction hash: ${result.txHash}`, true);
      
      // Update balances after a short delay
      setTimeout(updateBalances, 2000);
    } else {
      showStatus(`Transfer failed: ${result.error}`, false);
    }
  } catch (error) {
    console.error('Error in transfer:', error);
    showStatus('Error: ' + error.message, false);
  } finally {
    transferBtn.disabled = false;
  }
}

// Send meta-transaction
async function sendMetaTransaction(to, amount) {
  try {
    const from = account.address;
    const nonce = await getNonce(FORWARDER_ADDRESS, from);

    // Encode the transfer function call
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to, amount]
    });

    // Create the forward request
    const request = {
      from,
      to: TOKEN_ADDRESS,
      value: 0n,
      gas: 200000n,
      nonce,
      data,
    };

    // Get the EIP-712 domain separator
    const domain = {
      name: 'MinimalForwarder',
      version: '0.0.1',
      chainId: 84532, // Base Sepolia chain ID
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

    // Create the relay request with BigInt values converted to strings for JSON serialization
    const relayRequest = {
      request: {
        from: request.from,
        to: request.to,
        value: request.value.toString(),
        gas: request.gas.toString(),
        nonce: request.nonce.toString(),
        data: request.data,
      },
      signature,
    };

    // Send the relay request to the relayer
    const response = await fetch(RELAYER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(relayRequest),
    });

    const responseData = await response.json();
    
    if (!responseData.success) {
      throw new Error(responseData.error || 'Unknown error from relayer');
    }
    
    return { 
      success: true, 
      txHash: responseData.transactionHash,
      receipt: responseData.receipt 
    };
  } catch (error) {
    console.error('Error sending meta-transaction:', error);
    return { 
      success: false, 
      error: error.message || 'Unknown error' 
    };
  }
}

// Show status message
function showStatus(message, isSuccess) {
  statusEl.textContent = message;
  statusEl.style.display = 'block';
  
  if (isSuccess !== undefined) {
    statusEl.className = 'status ' + (isSuccess ? 'success' : 'error');
  } else {
    statusEl.className = 'status';
  }
}

// Initialize the app
init();
