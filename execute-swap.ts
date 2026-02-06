import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import fs from 'fs';

// Load private key from file
const walletData = JSON.parse(fs.readFileSync('/Users/d1f/clawd/molusco-wallet.json', 'utf-8'));
const privateKey = bs58.encode(Buffer.from(walletData));
const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const JUPITER_API = 'https://quote-api.jup.ag/v6';

const WALLET_ADDRESS = 'BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ';
const JITOSOL_MINT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

async function executeRealSwap() {
  console.log('🦞 Executing REAL swap: 0.5 SOL → JitoSOL\n');
  console.log(`Wallet: ${WALLET_ADDRESS}`);
  console.log(`Amount: 0.5 SOL = 500,000,000 lamports\n`);

  try {
    // Step 1: Get quote from Jupiter
    console.log('Step 1: Getting quote from Jupiter...');
    const quoteResponse = await axios.get(`${JUPITER_API}/quote`, {
      params: {
        inputMint: WRAPPED_SOL,
        outputMint: JITOSOL_MINT,
        amount: 500000000, // 0.5 SOL in lamports
        slippageBps: 100, // 1%
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      },
    });

    const quote = quoteResponse.data;
    console.log('✓ Quote received:');
    console.log(`  Input: 0.5 SOL`);
    console.log(`  Expected Output: ${(quote.outAmount / 1e9).toFixed(6)} JitoSOL`);
    console.log(`  Price Impact: ${quote.priceImpactPct}%`);
    console.log(`  Route: ${quote.routePlan.map((r: any) => r.swapInfo.label).join(' → ')}\n`);

    // Step 2: Get swap transaction
    console.log('Step 2: Building swap transaction...');
    const swapResponse = await axios.post(`${JUPITER_API}/swap`, {
      quoteResponse: quote,
      userPublicKey: WALLET_ADDRESS,
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 50000, // 0.00005 SOL priority fee
    });

    const { swapTransaction } = swapResponse.data;
    console.log('✓ Transaction built\n');

    // Step 3: Deserialize and sign transaction
    console.log('Step 3: Signing transaction...');
    const transactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);
    
    // Sign with our keypair
    transaction.sign([keypair]);
    console.log('✓ Transaction signed\n');

    // Step 4: Send transaction
    console.log('Step 4: Sending transaction to Solana...');
    const signature = await connection.sendTransaction(transaction, {
      maxRetries: 3,
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('✓ Transaction sent!');
    console.log(`\n🎉 SUCCESS!`);
    console.log(`Signature: ${signature}`);
    console.log(`Solscan: https://solscan.io/tx/${signature}`);
    console.log(`\n💾 Saving transaction record...`);

    // Save transaction record
    const record = {
      timestamp: new Date().toISOString(),
      type: 'SWAP',
      input: { token: 'SOL', amount: 0.5 },
      output: { token: 'JitoSOL', amount: parseFloat(quote.outAmount) / 1e9 },
      signature,
      solscanUrl: `https://solscan.io/tx/${signature}`,
      priceImpact: quote.priceImpactPct,
      route: quote.routePlan.map((r: any) => r.swapInfo.label),
    };

    fs.writeFileSync('/Users/d1f/clawd/moluscoyield/FIRST_TRANSACTION.json', JSON.stringify(record, null, 2));
    
    console.log('✓ Record saved to FIRST_TRANSACTION.json');
    console.log('\n🦞⚡ First real transaction executed!');

    return signature;

  } catch (error) {
    console.error('\n❌ Transaction failed:', error);
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data);
    }
    throw error;
  }
}

executeRealSwap();
