#!/usr/bin/env node
/**
 * Execute First Real Transaction
 * 
 * This script performs a REAL swap on Solana mainnet:
 * 0.5 SOL → JitoSOL via Jupiter
 * 
 * Usage: node execute-first-swap.js
 * Requires: SOLANA_PRIVATE_KEY environment variable or .env file
 */

const { Connection, Keypair, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const axios = require('axios');
const bs58 = require('bs58');
const fs = require('fs');

// Configuration
const CONFIG = {
  SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
  JUPITER_API: 'https://quote-api.jup.ag/v6',
  WALLET_ADDRESS: 'BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ',
  JITOSOL_MINT: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  WRAPPED_SOL: 'So11111111111111111111111111111111111111112',
  AMOUNT_SOL: 0.5,
  SLIPPAGE_BPS: 100, // 1%
};

async function loadWallet() {
  // Try environment variable first
  let privateKeyBase58 = process.env.SOLANA_PRIVATE_KEY;
  
  // Fallback to file
  if (!privateKeyBase58 && fs.existsSync('/Users/d1f/clawd/molusco-wallet.json')) {
    const walletData = JSON.parse(fs.readFileSync('/Users/d1f/clawd/molusco-wallet.json', 'utf-8'));
    privateKeyBase58 = bs58.encode(Buffer.from(walletData));
  }
  
  if (!privateKeyBase58) {
    throw new Error('No private key found. Set SOLANA_PRIVATE_KEY env var or ensure molusco-wallet.json exists.');
  }
  
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
  
  // Verify address matches
  if (keypair.publicKey.toString() !== CONFIG.WALLET_ADDRESS) {
    throw new Error('Private key does not match expected wallet address');
  }
  
  return keypair;
}

async function executeSwap() {
  console.log('\n' + '='.repeat(70));
  console.log('🦞 MOLUSCOYIELD - FIRST REAL TRANSACTION');
  console.log('='.repeat(70) + '\n');
  
  console.log(`Wallet: ${CONFIG.WALLET_ADDRESS}`);
  console.log(`Amount: ${CONFIG.AMOUNT_SOL} SOL → JitoSOL`);
  console.log(`Slippage: ${CONFIG.SLIPPAGE_BPS / 100}%\n`);

  const connection = new Connection(CONFIG.SOLANA_RPC, 'confirmed');
  const wallet = await loadWallet();
  
  console.log('✅ Wallet loaded and verified\n');

  try {
    // Step 1: Get quote
    console.log('📡 Step 1: Getting quote from Jupiter...');
    const quoteResponse = await axios.get(`${CONFIG.JUPITER_API}/quote`, {
      params: {
        inputMint: CONFIG.WRAPPED_SOL,
        outputMint: CONFIG.JITOSOL_MINT,
        amount: Math.floor(CONFIG.AMOUNT_SOL * 1e9), // lamports
        slippageBps: CONFIG.SLIPPAGE_BPS,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      },
      timeout: 30000,
    });

    const quote = quoteResponse.data;
    console.log('✅ Quote received:');
    console.log(`   Input: ${CONFIG.AMOUNT_SOL} SOL`);
    console.log(`   Expected Output: ${(quote.outAmount / 1e9).toFixed(6)} JitoSOL`);
    console.log(`   Price Impact: ${quote.priceImpactPct}%`);
    console.log(`   Route: ${quote.routePlan?.map(r => r.swapInfo?.label).join(' → ')}\n`);

    // Step 2: Get swap transaction
    console.log('📡 Step 2: Building swap transaction...');
    const swapResponse = await axios.post(`${CONFIG.JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: CONFIG.WALLET_ADDRESS,
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 50000, // 0.00005 SOL
    }, { timeout: 30000 });

    const { swapTransaction } = swapResponse.data;
    console.log('✅ Transaction built\n');

    // Step 3: Sign
    console.log('🔐 Step 3: Signing transaction...');
    const transactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);
    transaction.sign([wallet]);
    console.log('✅ Transaction signed\n');

    // Step 4: Send
    console.log('📤 Step 4: Broadcasting to Solana...');
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 3,
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('✅ Transaction broadcasted!\n');
    console.log('='.repeat(70));
    console.log('🎉 SUCCESS! FIRST REAL TRANSACTION EXECUTED');
    console.log('='.repeat(70));
    console.log(`\nSignature: ${signature}`);
    console.log(`Solscan:   https://solscan.io/tx/${signature}`);
    console.log(`Explorer:  https://explorer.solana.com/tx/${signature}`);
    console.log(`\n💰 You now have ${(quote.outAmount / 1e9).toFixed(6)} JitoSOL`);
    console.log('🦞 Welcome to real DeFi.\n');

    // Save record
    const record = {
      timestamp: new Date().toISOString(),
      type: 'FIRST_REAL_SWAP',
      input: { token: 'SOL', amount: CONFIG.AMOUNT_SOL },
      output: { token: 'JitoSOL', amount: quote.outAmount / 1e9 },
      signature,
      solscanUrl: `https://solscan.io/tx/${signature}`,
      priceImpact: quote.priceImpactPct,
      route: quote.routePlan?.map(r => r.swapInfo?.label),
    };

    fs.writeFileSync('FIRST_TRANSACTION.json', JSON.stringify(record, null, 2));
    console.log('💾 Transaction saved to FIRST_TRANSACTION.json\n');

    return signature;

  } catch (error) {
    console.error('\n❌ Transaction failed:', error.message);
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  executeSwap().catch(console.error);
}

module.exports = { executeSwap, loadWallet };
