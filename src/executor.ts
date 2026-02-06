import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';
import * as bs58 from 'bs58';
import { YieldOpportunity } from './scanner';

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  gasUsed?: number;
  timestamp: Date;
  solscanUrl?: string;
}

export interface Position {
  id: string;
  opportunity: YieldOpportunity;
  amount: number;
  entryApy: number;
  entryTimestamp: Date;
  currentValue: number;
  unrealizedYield: number;
  txSignature: string;
}

export class YieldExecutor {
  private connection: Connection;
  private wallet: Keypair;
  private walletPublicKey: PublicKey;
  private jupiterApi: string;
  private positions: Map<string, Position> = new Map();
  private isDryRun: boolean;

  constructor(
    connection: Connection, 
    walletPublicKey: PublicKey,
    privateKeyBase58?: string
  ) {
    this.connection = connection;
    this.walletPublicKey = walletPublicKey;
    this.jupiterApi = 'https://quote-api.jup.ag/v6';
    
    // Load private key if provided, otherwise dry-run mode
    if (privateKeyBase58) {
      try {
        this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
        // Verify wallet matches
        if (this.wallet.publicKey.toString() !== walletPublicKey.toString()) {
          throw new Error('Private key does not match wallet address');
        }
        this.isDryRun = false;
        console.log('✅ Wallet loaded for REAL transactions');
      } catch (error) {
        console.error('❌ Failed to load wallet:', error);
        this.isDryRun = true;
      }
    } else {
      console.log('⚠️  No private key provided - running in DRY-RUN mode');
      this.isDryRun = true;
    }
  }

  /**
   * Execute a REAL swap via Jupiter
   */
  async executeSwap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100 // 1%
  ): Promise<ExecutionResult> {
    const timestamp = new Date();
    
    console.log(`\n🔄 Executing swap:`);
    console.log(`   Input: ${amount} lamports of ${inputMint}`);
    console.log(`   Output: ${outputMint}`);
    console.log(`   Slippage: ${slippageBps / 100}%`);
    console.log(`   Mode: ${this.isDryRun ? 'DRY-RUN' : 'REAL TRANSACTION'}\n`);

    try {
      // Step 1: Get quote from Jupiter
      console.log('Step 1: Getting quote from Jupiter...');
      const quoteResponse = await axios.get(
        `${this.jupiterApi}/quote`,
        {
          params: {
            inputMint,
            outputMint,
            amount,
            slippageBps,
            onlyDirectRoutes: false,
            asLegacyTransaction: false,
          },
          timeout: 30000,
        }
      );

      const quote = quoteResponse.data;
      console.log('✓ Quote received:');
      console.log(`  Input: ${amount} lamports`);
      console.log(`  Expected Output: ${quote.outAmount} lamports`);
      console.log(`  Price Impact: ${quote.priceImpactPct}%`);
      console.log(`  Route: ${quote.routePlan?.map((r: any) => r.swapInfo?.label || 'unknown').join(' → ')}\n`);

      // If dry-run, return early
      if (this.isDryRun) {
        console.log('⚠️  DRY-RUN: Transaction NOT sent to blockchain');
        return {
          success: true,
          signature: 'dry-run-swap',
          timestamp,
          solscanUrl: undefined,
        };
      }

      // Step 2: Get swap transaction from Jupiter
      console.log('Step 2: Building swap transaction...');
      const swapResponse = await axios.post(
        `${this.jupiterApi}/swap`,
        {
          quoteResponse: quote,
          userPublicKey: this.walletPublicKey.toString(),
          wrapAndUnwrapSol: true,
          useSharedAccounts: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 50000, // 0.00005 SOL priority fee
        },
        { timeout: 30000 }
      );

      const { swapTransaction } = swapResponse.data;
      console.log('✓ Transaction built\n');

      // Step 3: Deserialize and sign transaction
      console.log('Step 3: Signing transaction...');
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      
      transaction.sign([this.wallet]);
      console.log('✓ Transaction signed\n');

      // Step 4: Send transaction to Solana
      console.log('Step 4: Broadcasting transaction...');
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          maxRetries: 3,
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        }
      );

      console.log('✓ Transaction broadcasted!');
      console.log(`  Signature: ${signature}`);
      console.log(`  Solscan: https://solscan.io/tx/${signature}\n`);

      // Step 5: Wait for confirmation (optional, non-blocking)
      this.connection.confirmTransaction(signature, 'confirmed')
        .then(() => console.log(`✓ Transaction confirmed: ${signature.slice(0, 16)}...`))
        .catch(err => console.error(`Confirmation error: ${err.message}`));

      return {
        success: true,
        signature,
        timestamp,
        solscanUrl: `https://solscan.io/tx/${signature}`,
        gasUsed: 50000, // Priority fee
      };

    } catch (error) {
      console.error('\n❌ Swap failed:', error);
      if (axios.isAxiosError(error)) {
        console.error('API Error:', error.response?.data);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  /**
   * Stake SOL into an LST via REAL swap
   */
  async stakeIntoLST(
    lstSymbol: string,
    amountSol: number
  ): Promise<ExecutionResult> {
    const lstMints: Record<string, string> = {
      'JitoSOL': 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
      'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      'bSOL': 'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk',
    };

    const outputMint = lstMints[lstSymbol];
    if (!outputMint) {
      return {
        success: false,
        error: `Unknown LST: ${lstSymbol}`,
        timestamp: new Date(),
      };
    }

    // Wrap SOL and swap to LST
    const wrappedSol = 'So11111111111111111111111111111111111111112';
    const amountLamports = Math.floor(amountSol * 1e9);

    return this.executeSwap(wrappedSol, outputMint, amountLamports);
  }

  /**
   * Execute first REAL transaction: 0.5 SOL → JitoSOL
   */
  async executeFirstRealTransaction(): Promise<ExecutionResult> {
    console.log('\n' + '='.repeat(60));
    console.log('🦞 EXECUTING FIRST REAL TRANSACTION');
    console.log('='.repeat(60) + '\n');
    console.log(`Wallet: ${this.walletPublicKey.toString()}`);
    console.log(`Amount: 0.5 SOL → JitoSOL`);
    console.log(`Mode: ${this.isDryRun ? 'DRY-RUN (no private key)' : 'REAL'}\n`);

    return this.stakeIntoLST('JitoSOL', 0.5);
  }

  /**
   * Execute optimal rebalancing with REAL transactions
   */
  async executeRebalancing(
    allocations: Array<{ opportunity: YieldOpportunity; allocation: number }>
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const alloc of allocations) {
      const opp = alloc.opportunity;
      
      console.log(`\nExecuting: ${opp.protocol} - ${opp.strategy}`);
      console.log(`Amount: ${alloc.allocation} SOL`);

      let result: ExecutionResult;

      if (opp.strategy === 'Liquid Staking') {
        result = await this.stakeIntoLST(opp.protocol, alloc.allocation);
      } else if (opp.protocol === 'Kamino') {
        // For Kamino, we would integrate their SDK here
        // For now, return not-implemented
        result = {
          success: false,
          error: 'Kamino integration not yet implemented',
          timestamp: new Date(),
        };
      } else {
        result = {
          success: false,
          error: `Unknown protocol: ${opp.protocol}`,
          timestamp: new Date(),
        };
      }

      results.push(result);

      // Track position if successful
      if (result.success && result.signature && result.signature !== 'dry-run-swap') {
        this.trackPosition(opp, alloc.allocation, opp.apy, result.signature);
      }
    }

    return results;
  }

  /**
   * Track a new position
   */
  private trackPosition(
    opportunity: YieldOpportunity,
    amount: number,
    apy: number,
    txSignature: string
  ): void {
    const position: Position = {
      id: `${opportunity.protocol}-${Date.now()}`,
      opportunity,
      amount,
      entryApy: apy,
      entryTimestamp: new Date(),
      currentValue: amount,
      unrealizedYield: 0,
      txSignature,
    };

    this.positions.set(position.id, position);
    console.log(`✓ Position tracked: ${position.id}`);
    console.log(`  Tx: https://solscan.io/tx/${txSignature}`);
  }

  /**
   * Get all current positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check if running in dry-run mode
   */
  isDryRunMode(): boolean {
    return this.isDryRun;
  }

  /**
   * Calculate total portfolio value
   */
  async getPortfolioValue(): Promise<number> {
    const solBalance = await this.connection.getBalance(this.walletPublicKey);
    const solValue = solBalance / 1e9;

    const positionValue = this.getPositions().reduce(
      (sum, pos) => sum + pos.currentValue,
      0
    );

    return solValue + positionValue;
  }
}

// CLI for testing
if (require.main === module) {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const walletPublicKey = new PublicKey('BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ');
  
  // Load private key from environment or file if available
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  
  const executor = new YieldExecutor(connection, walletPublicKey, privateKey);
  
  executor.executeFirstRealTransaction()
    .then(result => {
      console.log('\n' + '='.repeat(60));
      console.log('RESULT:', result.success ? 'SUCCESS ✅' : 'FAILED ❌');
      if (result.signature) {
        console.log('Signature:', result.signature);
        console.log('Solscan:', result.solscanUrl);
      }
      if (result.error) {
        console.log('Error:', result.error);
      }
      console.log('='.repeat(60));
    })
    .catch(console.error);
}
