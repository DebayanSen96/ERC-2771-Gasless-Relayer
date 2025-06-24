// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract TestToken is ERC20, ERC2771Context {
    address public owner;
    uint256 public constant MINT_AMOUNT = 1000 * 10**18;

    constructor(address forwarder) 
        ERC20("TestToken", "TTK") 
        ERC2771Context(forwarder) 
    {
        owner = _msgSender();
        _mint(owner, 1000000 * 10**18);
    }

    function mintToSender() external {
        _mint(_msgSender(), MINT_AMOUNT);
    }

    function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }
    
    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
