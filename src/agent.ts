import { Connection, PublicKey } from '@solana/web3.js';
import { YieldScanner } from './scanner';
import { RiskManager } from './risk';
import { PerformanceDashboard, DecisionLog } from './dashboard';
import { LiveDataFeed } from './liveDataFeed';

export interface AgentConfig {
  checkIntervalHours: number;
  rebalanceThreshold: number; // Minimum APY difference to trigger rebalance
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  minYieldThreshold: number;
  maxSlippage: number;
}

export interface Position {
  protocol: string;
  asset: string;
  amount: number;
  entryApy: number;
  entryTimestamp: Date;
}

export class YieldAgent {
  private connection: Connection;
  private wallet: PublicKey;
  private scanner: YieldScanner;
  private riskManager: RiskManager;
  private dashboard: PerformanceDashboard;
  private liveData: LiveDataFeed;
  private config: AgentConfig;
  private isRunning: boolean = false;
  private positions: Position[] = [];

  constructor(
    connection: Connection,
    walletPublicKey: PublicKey,
    config: Partial<AgentConfig> = {}
  ) {
    this.connection = connection;
    this.wallet = walletPublicKey;
    this.scanner = new YieldScanner();
    this.riskManager = new RiskManager();
    this.dashboard = new PerformanceDashboard(connection, walletPublicKey);
    this.liveData = new LiveDataFeed();
    
    this.config = {
      checkIntervalHours: 6,
      rebalanceThreshold: 0.02, // 2%
      riskTolerance: 'moderate',
      minYieldThreshold: 0.05, // 5%
      maxSlippage: 0.01, // 1%
      ...config,
    };
  }

  /**
   * Main agent loop - runs indefinitely
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log('🦞 MoluscoYield Agent Starting...\n');
    console.log(`Configuration:`);
    console.log(`  Check Interval: ${this.config.checkIntervalHours} hours`);
    console.log(`  Rebalance Threshold: ${(this.config.rebalanceThreshold * 100).toFixed(1)}%`);
    console.log(`  Risk Tolerance: ${this.config.riskTolerance}`);
    console.log(`  Wallet: ${this.wallet.toString()}\n`);

    // Initial scan
    await this.runCycle();

    // Schedule next cycles
    while (this.isRunning) {
      const intervalMs = this.config.checkIntervalHours * 60 * 60 * 1000;
      console.log(`\n⏰ Sleeping for ${this.config.checkIntervalHours} hours...\n`);
      await this.sleep(intervalMs);
      
      if (this.isRunning) {
        await this.runCycle();
      }
    }
  }

  /**
   * Stop the agent gracefully
   */
  stop(): void {
    console.log('\n🛑 Stopping agent...');
    this.isRunning = false;
  }

  /**
   * Run a single decision cycle
   */
  private async runCycle(): Promise<void> {
    const timestamp = new Date();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Cycle Started: ${timestamp.toISOString()}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // Step 1: Get market data
      console.log('📊 Step 1: Gathering market data...');
      const marketOverview = await this.liveData.getMarketOverview();
      console.log(`  ✓ Live prices: SOL $${marketOverview.prices.solPrice.toFixed(2)}`);
      console.log(`  ✓ LST opportunities: ${marketOverview.lstData.length}`);
      console.log(`  ✓ Kamino vaults: ${marketOverview.kaminoVaults.length}`);

      // Step 2: Scan all opportunities
      console.log('\n🔍 Step 2: Scanning yield opportunities...');
      const opportunities = await this.scanner.scanAllOpportunities();
      this.scanner.printScanResults(opportunities);

      // Step 3: Get current position
      console.log('\n💼 Step 3: Checking current position...');
      const currentPosition = await this.getCurrentPosition();
      if (currentPosition) {
        console.log(`  Current: ${currentPosition.protocol} @ ${(currentPosition.entryApy * 100).toFixed(2)}% APY`);
      } else {
        console.log('  No active position. Ready to enter.');
      }

      // Step 4: Detect market regime
      console.log('\n🌊 Step 4: Detecting market regime...');
      const regime = await this.riskManager.detectRegime();
      console.log(`  Regime: ${regime.regime.toUpperCase()}`);
      console.log(`  Strategy: ${this.riskManager.getRegimeStrategy(regime.regime).liquidityPriority > 0.5 ? 'Liquidity First' : 'Yield First'}`);

      // Step 5: Check if we should halt
      if (this.riskManager.shouldHalt(regime, 0)) {
        console.log('\n🛑 CIRCUIT BREAKER TRIGGERED - Halting operations');
        this.dashboard.logDecision({
          timestamp,
          action: 'HOLD',
          reason: `Circuit breaker: ${regime.regime} regime detected. Solana TPS: ${regime.solanaTps}`,
        });
        return;
      }

      // Step 6: Calculate optimal allocation
      console.log('\n🎯 Step 5: Calculating optimal allocation...');
      const balance = await this.getWalletBalance();
      const allocations = this.scanner.calculateOptimalAllocation(
        opportunities,
        balance,
        this.config.riskTolerance
      );

      const bestOpportunity = allocations[0];
      console.log(`  Best: ${bestOpportunity.opportunity.protocol} @ ${(bestOpportunity.opportunity.apy * 100).toFixed(2)}% APY`);
      console.log(`  Allocation: $${bestOpportunity.allocation.toFixed(2)} (${(bestOpportunity.allocation / balance * 100).toFixed(1)}%)`);

      // Step 7: Decide action
      const decision = this.makeDecision(currentPosition, bestOpportunity);
      console.log(`\n✅ DECISION: ${decision.action}`);
      console.log(`   Reason: ${decision.reason}\n`);

      // Step 8: Execute or hold
      if (decision.action === 'REBALANCE' || decision.action === 'ENTER') {
        console.log('⚡ Executing rebalancing...');
        // Note: Actual execution would happen here with real wallet
        // For now, we log the decision
        this.dashboard.logDecision({
          timestamp,
          action: decision.action,
          reason: decision.reason,
          opportunities: opportunities.slice(0, 3),
          allocations,
        });
        
        // Update position tracking
        this.positions = [{
          protocol: bestOpportunity.opportunity.protocol,
          asset: bestOpportunity.opportunity.asset,
          amount: bestOpportunity.allocation,
          entryApy: bestOpportunity.opportunity.apy,
          entryTimestamp: timestamp,
        }];
        
        console.log('  ✓ Decision logged. Ready for execution.');
        
      } else {
        // HOLD
        this.dashboard.logDecision({
          timestamp,
          action: 'HOLD',
          reason: decision.reason,
        });
        console.log('  ✓ Hold position. No action taken.');
      }

      // Step 9: Update dashboard
      console.log('\n📈 Updating performance dashboard...');
      await this.dashboard.saveReport();
      console.log('  ✓ PERFORMANCE.md updated');

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ Cycle Complete: ${new Date().toISOString()}`);
      console.log(`${'='.repeat(60)}\n`);

    } catch (error) {
      console.error('\n❌ Cycle failed:', error);
      this.dashboard.logDecision({
        timestamp,
        action: 'HOLD',
        reason: `Error during cycle: ${error}`,
      });
    }
  }

  /**
   * Make decision based on current position vs best opportunity
   */
  private makeDecision(
    currentPosition: Position | null,
    bestOpportunity: { opportunity: any; allocation: number; expectedYield: number }
  ): { action: 'HOLD' | 'REBALANCE' | 'ENTER'; reason: string } {
    
    // If no position, enter
    if (!currentPosition) {
      return {
        action: 'ENTER',
        reason: `No active position. Entering ${bestOpportunity.opportunity.protocol} at ${(bestOpportunity.opportunity.apy * 100).toFixed(2)}% APY`,
      };
    }

    // Calculate APY difference
    const currentApy = currentPosition.entryApy;
    const newApy = bestOpportunity.opportunity.apy;
    const apyDiff = newApy - currentApy;

    // If difference is above threshold, rebalance
    if (apyDiff > this.config.rebalanceThreshold) {
      return {
        action: 'REBALANCE',
        reason: `APY improvement: ${(apyDiff * 100).toFixed(2)}% (${currentPosition.protocol} ${(currentApy * 100).toFixed(2)}% → ${bestOpportunity.opportunity.protocol} ${(newApy * 100).toFixed(2)}%)`,
      };
    }

    // Otherwise, hold
    return {
      action: 'HOLD',
      reason: `Current position optimal. APY diff ${(apyDiff * 100).toFixed(2)}% below threshold ${(this.config.rebalanceThreshold * 100).toFixed(1)}%`,
    };
  }

  /**
   * Get current position (simplified - would check on-chain in production)
   */
  private async getCurrentPosition(): Promise<Position | null> {
    return this.positions[0] || null;
  }

  /**
   * Get wallet balance in USD
   */
  private async getWalletBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet);
    const solBalance = balance / 1e9;
    
    // Get SOL price
    const prices = await this.liveData.fetchPrices();
    return solBalance * prices.solPrice;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI
if (require.main === module) {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const wallet = new PublicKey('BSSKDqjLriEFxctBotvnVfFLMun73CVvRSBbBs9AVXsZ');
  
  const agent = new YieldAgent(connection, wallet, {
    checkIntervalHours: 0.1, // 6 minutes for demo (change to 6 for production)
    rebalanceThreshold: 0.02,
    riskTolerance: 'moderate',
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    agent.stop();
    process.exit(0);
  });

  agent.start().catch(console.error);
}
