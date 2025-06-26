import { ethers } from 'ethers';

// Get the function selector for getNonce(address)
const iface = new ethers.Interface([
  'function getNonce(address from) view returns (uint256)'
]);

const selector = iface.getFunction('getNonce')?.selector;
console.log('Function selector for getNonce(address):', selector);
