#!/usr/bin/env node

import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { YieldScanner } from './scanner';
import { YieldExecutor } from './executor';
import * as dotenv from 'dotenv';

dotenv.config();

const WALLET_ADDRESS = 'BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ';

async function scan() {
  console.log('🔍 MoluscoYield Scanner\n');
  
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
  );
  const scanner = new YieldScanner(connection);

  const opportunities = await scanner.scanAllOpportunities();
  
  console.log('📊 Yield Opportunities:');
  console.log('─'.repeat(80));
  opportunities.forEach((opp, i) => {
    console.log(
      `${(i + 1).toString().padStart(2)}. ${opp.protocol.padEnd(12)} | ` +
      `${opp.strategy.padEnd(20)} | ${(opp.apy * 100).toFixed(1)}% APY | ` +
      `${opp.risk.toUpperCase().padEnd(6)} | $${(opp.tvl / 1e6).toFixed(1)}M TVL`
    );
  });
  console.log('─'.repeat(80));
}

async function dryRun() {
  console.log('🧪 MoluscoYield Dry Run\n');
  
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta')
  );
  const wallet = new PublicKey(WALLET_ADDRESS);
  const scanner = new YieldScanner(connection);
  const executor = new YieldExecutor(connection, wallet);

  const balance = await connection.getBalance(wallet);
  const solBalance = balance / 1e9;

  console.log(`Wallet: ${wallet.toString()}`);
  console.log(`Balance: ${solBalance.toFixed(4)} SOL\n`);

  const opportunities = await scanner.scanAllOpportunities();
  const allocations = scanner.calculateOptimalAllocation(
    opportunities,
    solBalance,
    'moderate'
  );

  console.log('📝 Would execute the following rebalancing:\n');
  
  for (const alloc of allocations) {
    console.log(`Swap ${alloc.allocation.toFixed(4)} SOL → ${alloc.opportunity.protocol}`);
    console.log(`  Expected APY: ${(alloc.opportunity.apy * 100).toFixed(1)}%`);
    console.log(`  Risk Level: ${alloc.opportunity.risk}\n`);
  }

  console.log('✅ Dry run complete (no transactions executed)');
}

async function execute() {
  console.log('⚡ MoluscoYield Executor\n');
  console.log('WARNING: This will execute REAL transactions with REAL money!\n');
  
  // In production, this would actually execute trades
  console.log('🔒 Execution mode not yet enabled for safety.');
  console.log('Please review the dry-run output first.\n');
}

// CLI dispatch
const command = process.argv[2];

switch (command) {
  case 'scan':
    scan().catch(console.error);
    break;
  case 'dry-run':
    dryRun().catch(console.error);
    break;
  case 'execute':
    execute().catch(console.error);
    break;
  default:
    console.log('MoluscoYield CLI\n');
    console.log('Usage:');
    console.log('  npm run scan       - Scan for yield opportunities');
    console.log('  npm run dry-run    - Simulate rebalancing');
    console.log('  npm run execute    - Execute rebalancing (REAL MONEY)');
    process.exit(1);
}
