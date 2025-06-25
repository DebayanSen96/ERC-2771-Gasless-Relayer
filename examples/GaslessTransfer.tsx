import { useState } from 'react';
import { createWalletClient, http, parseEther, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/*
 * Example React component that submits a gas-less token transfer via the meta-tx relayer.
 * It uses the SAME signing flow the CLI/frontend use: build ForwardRequest, sign EIP-712, POST to /relay.
 */

// ---------- Config (normally env vars) ----------
const RPC_URL = 'https://sepolia.base.org';
const RELAYER_URL = 'http://localhost:3000/relay';
const FORWARDER_ADDRESS = '0x9a42dc931963A42750B344a56fAd5e3B7A276595';
const TOKEN_ADDRESS = '0x046fA5D44953673294Bc97F5ACbF346Be544a3Fe';
// unfunded wallet that owns TT but has 0 ETH
const PRIVATE_KEY_UNFUNDED = process.env.NEXT_PUBLIC_PRIVATE_KEY_UNFUNDED as `0x${string}`;

// ---------- Minimal ABI ----------
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
] as const;

type ForwardRequest = {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  data: `0x${string}`;
};

export default function GaslessTransfer() {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  async function getNonce(forwarder: `0x${string}`, from: `0x${string}`) {
    const functionSelector = '0x2d0335ab'; // getNonce(address)
    const padded = from.slice(2).padStart(64, '0');
    const data = `${functionSelector}${padded}` as `0x${string}`;

    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [ { to: forwarder, data }, 'latest' ]
      })
    });
    const json = await res.json();
    if (!json.result) throw new Error('RPC error');
    return BigInt(json.result as string);
  }

  async function handleTransfer() {
    try {
      setError('');
      setTxHash('');

      const account = privateKeyToAccount(PRIVATE_KEY_UNFUNDED);
      const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

      // 1. Build calldata for ERC20.transfer(to, amount)
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to as `0x${string}`, parseEther(amount)]
      });

      // 2. Build ForwardRequest
      const nonce = await getNonce(FORWARDER_ADDRESS, account.address);
      const request: ForwardRequest = {
        from: account.address,
        to: TOKEN_ADDRESS,
        value: 0n,
        gas: 200000n,
        nonce,
        data
      };

      // 3. Sign typed data (EIP-712)
      const domain = {
        name: 'MinimalForwarder',
        version: '0.0.1',
        chainId: 84532,
        verifyingContract: FORWARDER_ADDRESS
      } as const;

      const types = {
        ForwardRequest: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ]
      } as const;

      const signature = await walletClient.signTypedData({
        domain,
        types,
        primaryType: 'ForwardRequest',
        message: request
      });

      // 4. POST to relayer
      const res = await fetch(RELAYER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: {
            ...request,
            // convert bigint -> string for JSON
            value: request.value.toString(),
            gas: request.gas.toString(),
            nonce: request.nonce.toString()
          },
          signature
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Relayer error');
      setTxHash(json.transactionHash);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h3>Gas-less transfer via relayer</h3>
      <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient" />
      <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="amount" />
      <button onClick={handleTransfer}>Send Gas-less</button>
      {txHash && <p>Tx: {txHash}</p>}
      {error && <p style={{color:'red'}}>{error}</p>}
    </div>
  );
}
