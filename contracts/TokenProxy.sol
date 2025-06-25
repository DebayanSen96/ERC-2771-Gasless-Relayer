// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @title TokenProxy
 * @dev A proxy contract that can interact with any standard ERC-20 token using meta-transactions.
 * Users must first approve this contract to spend their tokens, then they can use gasless transactions
 * to transfer those tokens through this proxy.
 */
contract TokenProxy is ERC2771Context {
    // Events
    event TokenTransferred(address token, address from, address to, uint256 amount);
    event TokenMinted(address token, address to, uint256 amount);
    
    /**
     * @dev Constructor that sets the trusted forwarder for ERC2771Context
     * @param _trustedForwarder The address of the MinimalForwarder contract
     */
    constructor(address _trustedForwarder) ERC2771Context(_trustedForwarder) {}
    
    /**
     * @dev Transfer tokens from the meta-transaction signer to another address
     * @param token The ERC-20 token contract address
     * @param to The recipient address
     * @param amount The amount of tokens to transfer
     * @return success Whether the transfer was successful
     */
    function transferToken(address token, address to, uint256 amount) external returns (bool success) {
        // Get the real sender (the one who signed the meta-transaction)
        address sender = _msgSender();
        
        // Transfer tokens from sender to recipient using transferFrom
        // Note: sender must have approved this contract beforehand
        success = IERC20(token).transferFrom(sender, to, amount);
        require(success, "TokenProxy: transfer failed");
        
        emit TokenTransferred(token, sender, to, amount);
        return success;
    }
    
    /**
     * @dev For tokens that have a public mint function, allow gasless minting
     * This is a generic interface - the token contract must have a mint(address,uint256) function
     * @param token The token contract address that has a mint function
     * @param amount The amount to mint
     */
    function mintToken(address token, uint256 amount) external {
        address sender = _msgSender();

        // Try mint(address,uint256) first (OpenZeppelin style)
        (bool success, ) = token.call(
            abi.encodeWithSignature("mint(address,uint256)", sender, amount)
        );

        if (!success) {
            // Fallback: try mint(uint256) or publicMint(uint256)
            (success, ) = token.call(
                abi.encodeWithSignature("mint(uint256)", amount)
            );
            if (!success) {
                (success, ) = token.call(
                    abi.encodeWithSignature("publicMint(uint256)", amount)
                );
            }
            // If mint(uint256) or publicMint(uint256) succeeded, tokens were minted to the proxy itself.
            if (success) {
                // Transfer the freshly minted tokens to the original sender
                bool xfer = IERC20(token).transfer(sender, amount);
                require(xfer, "TokenProxy: transfer after mint failed");
            }
        }

        require(success, "TokenProxy: mint failed");
        emit TokenMinted(token, sender, amount);
    }
    
    /**
     * @dev Returns the current sender in the context of a meta-transaction
     * Can be used for debugging or verification
     */
    function getCurrentSender() external view returns (address) {
        return _msgSender();
    }
}
