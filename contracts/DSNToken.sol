// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DSNToken
 * @dev A standard ERC-20 token with mint functionality.
 * This token is NOT ERC-2771 aware and will be used with the TokenProxy for gasless transactions.
 */
contract DSNToken is ERC20, Ownable {
    /**
     * @dev Constructor that sets the name and symbol of the token
     * @param initialOwner The address that will own the contract and have minting rights
     */
    constructor(address initialOwner) 
        ERC20("DSN Token", "DSN") 
        Ownable(initialOwner) 
    {
        // Initial supply minted to the owner
        _mint(initialOwner, 1000000 * 10 ** decimals());
    }
    
    /**
     * @dev Mints new tokens to the specified address
     * @param to The address that will receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    /**
     * @dev Public mint function that anyone can call
     * For demonstration purposes only - in production you'd want access control
     * @param amount The amount of tokens to mint to the caller
     */
    function publicMint(uint256 amount) external {
        // In a real token, you'd want limits or other controls here
        _mint(msg.sender, amount);
    }
}
