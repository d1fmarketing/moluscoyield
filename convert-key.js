const fs = require('fs');
const bs58 = require('bs58');

// Read the wallet JSON
const walletData = JSON.parse(fs.readFileSync('/Users/d1f/clawd/molusco-wallet.json', 'utf-8'));

// Convert byte array to base58
const privateKeyBase58 = bs58.encode(Buffer.from(walletData));

console.log('Private Key (Base58):');
console.log(privateKeyBase58);
console.log('\nWallet Address: BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ');
console.log('\n⚠️  WARNING: Keep this secret!');
