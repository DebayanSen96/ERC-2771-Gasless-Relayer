import { useState } from 'react';
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = 'https://sepolia.base.org';
const TOKEN_ADDRESS = '0x046fA5D44953673294Bc97F5ACbF346Be544a3Fe';
const PRIVATE_KEY = process.env.NEXT_PUBLIC_PRIVATE_KEY as `0x${string}`;

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: []
  }
];

export default function DirectTransfer() {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');

  async function handleTransfer() {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const client = createWalletClient({ account, transport: http(RPC_URL) });
    const hash = await client.writeContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to as `0x${string}`, parseEther(amount)]
    });
    setTxHash(hash);
  }

  return (
    <div>
      <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient" />
      <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="amount" />
      <button onClick={handleTransfer}>Send</button>
      <p>{txHash}</p>
    </div>
  );
}
