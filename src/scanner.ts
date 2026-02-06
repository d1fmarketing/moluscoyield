import { LiveDataFeed } from './liveDataFeed';
import { RiskManager } from './risk';

export interface YieldOpportunity {
  protocol: string;
  strategy: string;
  asset: string;
  apy: number;
  tvl: number;
  risk: 'low' | 'medium' | 'high';
  type: 'lst' | 'kamino' | 'other';
  mint?: string;
}

export class YieldScanner {
  private liveData: LiveDataFeed;
  private riskManager: RiskManager;

  constructor() {
    this.liveData = new LiveDataFeed();
    this.riskManager = new RiskManager();
  }

  /**
   * Scan for all yield opportunities using REAL data
   */
  async scanAllOpportunities(): Promise<YieldOpportunity[]> {
    console.log('🔍 Scanning for yield opportunities with LIVE data...\n');

    const marketData = await this.liveData.getMarketOverview();
    const opportunities: YieldOpportunity[] = [];

    // Add LST opportunities
    for (const lst of marketData.lstData) {
      opportunities.push({
        protocol: lst.symbol,
        strategy: 'Liquid Staking',
        asset: 'SOL',
        apy: lst.apy,
        tvl: lst.tvl,
        risk: 'low',
        type: 'lst',
        mint: lst.mint,
      });
    }

    // Add Kamino vault opportunities
    for (const vault of marketData.kaminoVaults) {
      opportunities.push({
        protocol: 'Kamino',
        strategy: vault.name,
        asset: vault.token,
        apy: vault.apy,
        tvl: vault.tvl,
        risk: vault.risk,
        type: 'kamino',
      });
    }

    // Sort by APY descending
    return opportunities.sort((a, b) => b.apy - a.apy);
  }

  /**
   * Get market overview with best opportunities
   */
  async getMarketOverview() {
    return this.liveData.getMarketOverview();
  }

  /**
   * Calculate optimal allocation with risk management
   */
  calculateOptimalAllocation(
    opportunities: YieldOpportunity[],
    totalCapital: number,
    riskTolerance: 'conservative' | 'moderate' | 'aggressive' = 'moderate'
  ): Array<{ opportunity: YieldOpportunity; allocation: number; expectedYield: number }> {
    
    const allocations: Array<{ opportunity: YieldOpportunity; allocation: number; expectedYield: number }> = [];
    
    // Get risk-adjusted weights
    const riskWeights: Record<string, Record<'low' | 'medium' | 'high', number>> = {
      conservative: { low: 1.0, medium: 0.3, high: 0 },
      moderate: { low: 0.6, medium: 1.0, high: 0.3 },
      aggressive: { low: 0.3, medium: 0.7, high: 1.0 },
    };

    const weights = riskWeights[riskTolerance];

    // Score and filter opportunities
    const scored = opportunities.map(opp => ({
      opportunity: opp,
      score: opp.apy * weights[opp.risk],
    }));

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Take top 3
    const top3 = scored.slice(0, 3);
    const totalScore = top3.reduce((sum, s) => sum + s.score, 0);

    for (const item of top3) {
      const allocation = (item.score / totalScore) * totalCapital;
      const expectedYield = allocation * item.opportunity.apy;
      
      allocations.push({
        opportunity: item.opportunity,
        allocation,
        expectedYield,
      });
    }

    return allocations;
  }

  /**
   * Print scan results in a nice format
   */
  printScanResults(opportunities: YieldOpportunity[]) {
    console.log('📊 Live Yield Opportunities:');
    console.log('─'.repeat(80));
    
    opportunities.forEach((opp, i) => {
      const apyPct = (opp.apy * 100).toFixed(2);
      const tvlFormatted = opp.tvl > 1e9 
        ? `$${(opp.tvl / 1e9).toFixed(2)}B` 
        : opp.tvl > 1e6 
          ? `$${(opp.tvl / 1e6).toFixed(1)}M` 
          : `$${(opp.tvl / 1e3).toFixed(0)}K`;
      
      console.log(
        `${(i + 1).toString().padStart(2)}. ${opp.protocol.padEnd(15)} | ` +
        `${opp.strategy.padEnd(20)} | ${apyPct}% APY | ` +
        `${opp.risk.toUpperCase().padEnd(6)} | ${tvlFormatted} TVL`
      );
    });
    
    console.log('─'.repeat(80));
  }
}

// CLI for testing
if (require.main === module) {
  const scanner = new YieldScanner();
  
  scanner.scanAllOpportunities().then(opportunities => {
    scanner.printScanResults(opportunities);
    
    // Show optimal allocation for $220
    console.log('\n💡 Optimal Allocation ($220, moderate risk):');
    const allocations = scanner.calculateOptimalAllocation(opportunities, 220, 'moderate');
    
    allocations.forEach((alloc, i) => {
      console.log(
        `${i + 1}. ${alloc.opportunity.protocol}: $${alloc.allocation.toFixed(2)} ` +
        `(${(alloc.allocation / 220 * 100).toFixed(1)}%) → $${alloc.expectedYield.toFixed(2)}/year`
      );
    });
    
    const totalExpected = allocations.reduce((sum, a) => sum + a.expectedYield, 0);
    console.log(`\n   Total Expected Yield: $${totalExpected.toFixed(2)}/year (${(totalExpected / 220 * 100).toFixed(2)}% APY)`);
    
  }).catch(console.error);
}
