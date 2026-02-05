import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { YieldScanner } from './scanner';
import { YieldExecutor } from './executor';
import * as dotenv from 'dotenv';

dotenv.config();

const WALLET_ADDRESS = 'BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ';

async function main() {
  console.log('🦞 MoluscoYield - Autonomous DeFi Yield Optimizer\n');

  // Setup connection
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');
  const connection = new Connection(rpcUrl);
  const wallet = new PublicKey(WALLET_ADDRESS);

  console.log(`Wallet: ${wallet.toString()}`);
  console.log(`RPC: ${rpcUrl}\n`);

  // Initialize scanner and executor
  const scanner = new YieldScanner(connection);
  const executor = new YieldExecutor(connection, wallet);

  try {
    // Check wallet balance
    const balance = await connection.getBalance(wallet);
    const solBalance = balance / 1e9;
    console.log(`💰 Current Balance: ${solBalance.toFixed(4)} SOL\n`);

    // Scan for opportunities
    console.log('🔍 Scanning for yield opportunities...\n');
    const opportunities = await scanner.scanAllOpportunities();

    console.log('📊 Top Opportunities:');
    console.log('─'.repeat(70));
    opportunities.slice(0, 5).forEach((opp, i) => {
      const apyPct = (opp.apy * 100).toFixed(1);
      const tvlFormatted = (opp.tvl / 1e6).toFixed(1);
      console.log(
        `${i + 1}. ${opp.protocol.padEnd(12)} | ${opp.strategy.padEnd(20)} | ` +
        `${apyPct}% APY | $${tvlFormatted}M TVL | ${opp.risk.toUpperCase()} risk`
      );
    });
    console.log('─'.repeat(70) + '\n');

    // Calculate optimal allocation
    console.log('🎯 Calculating Optimal Allocation (Moderate Risk)...\n');
    const allocations = scanner.calculateOptimalAllocation(
      opportunities,
      solBalance,
      'moderate'
    );

    console.log('💡 Recommended Portfolio:');
    console.log('─'.repeat(70));
    let totalAllocated = 0;
    allocations.forEach((alloc, i) => {
      const pct = ((alloc.allocation / solBalance) * 100).toFixed(1);
      totalAllocated += alloc.allocation;
      console.log(
        `${i + 1}. ${alloc.opportunity.protocol.padEnd(12)} | ` +
        `${alloc.allocation.toFixed(4)} SOL (${pct}%) | ` +
        `${(alloc.opportunity.apy * 100).toFixed(1)}% APY`
      );
    });
    console.log('─'.repeat(70));
    console.log(`   Total Allocated: ${totalAllocated.toFixed(4)} SOL\n`);

    // Projected yield
    const projectedDaily = allocations.reduce(
      (sum, a) => sum + (a.allocation * a.opportunity.apy / 365),
      0
    );
    const projectedMonthly = projectedDaily * 30;
    const projectedYearly = projectedDaily * 365;

    console.log('📈 Projected Returns:');
    console.log(`   Daily:   ${projectedDaily.toFixed(6)} SOL ($${(projectedDaily * 220).toFixed(2)})`);
    console.log(`   Monthly: ${projectedMonthly.toFixed(4)} SOL ($${(projectedMonthly * 220).toFixed(2)})`);
    console.log(`   Yearly:  ${projectedYearly.toFixed(4)} SOL ($${(projectedYearly * 220).toFixed(2)})\n`);

    // Show current positions (if any)
    const positions = executor.getPositions();
    if (positions.length > 0) {
      console.log('📍 Current Positions:');
      positions.forEach(pos => {
        console.log(`   ${pos.opportunity.protocol}: ${pos.amount.toFixed(4)} SOL @ ${pos.entryApy}% APY`);
      });
      console.log();
    }

    console.log('✅ Scan complete. Run with --execute flag to perform rebalancing.\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
