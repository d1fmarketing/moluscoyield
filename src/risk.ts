export interface MarketRegime {
  regime: 'normal' | 'elevated' | 'crisis';
  vixLevel: number;
  solanaTps: number;
  lstSpreads: number;
  timestamp: Date;
}

export interface RiskMetrics {
  volatility30d: number;
  maxDrawdown: number;
  sharpeRatio: number;
  var95: number; // Value at Risk
}

export interface CostTracker {
  dailyApiCosts: number;      // USD
  dailyComputeCosts: number;  // USD
  dailyTransactionCosts: number; // USD in SOL
  grossYield: number;         // USD
  netYield: number;           // USD (after costs)
}

export class RiskManager {
  private vixThresholdHigh = 30;
  private vixThresholdCrisis = 40;
  private tpsThreshold = 1000;

  /**
   * Detect current market regime for strategy adjustment
   */
  async detectRegime(): Promise<MarketRegime> {
    // In production, fetch real data:
    // - VIX from traditional markets API
    // - Solana TPS from RPC
    // - LST spreads from Jupiter
    
    const mockRegime: MarketRegime = {
      regime: 'normal',
      vixLevel: 18,
      solanaTps: 3500,
      lstSpreads: 0.001, // 0.1%
      timestamp: new Date(),
    };

    return mockRegime;
  }

  /**
   * Adjust strategy based on market regime
   */
  getRegimeStrategy(regime: MarketRegime['regime']): {
    maxPositionDuration: number; // days
    preferredProtocols: string[];
    liquidityPriority: number; // 0-1
    yieldThreshold: number; // minimum APY
  } {
    switch (regime) {
      case 'crisis':
        return {
          maxPositionDuration: 1,
          preferredProtocols: ['JitoSOL', 'mSOL'], // most liquid
          liquidityPriority: 0.9,
          yieldThreshold: 0.03, // 3% - just preserve capital
        };
      case 'elevated':
        return {
          maxPositionDuration: 7,
          preferredProtocols: ['JitoSOL', 'mSOL', 'bSOL'],
          liquidityPriority: 0.6,
          yieldThreshold: 0.05, // 5%
        };
      case 'normal':
      default:
        return {
          maxPositionDuration: 30,
          preferredProtocols: ['JitoSOL', 'mSOL', 'bSOL', 'INF', 'Kamino'],
          liquidityPriority: 0.3,
          yieldThreshold: 0.06, // 6%
        };
    }
  }

  /**
   * Calculate position size based on Kelly Criterion
   */
  calculateKellyPosition(
    winRate: number,
    avgWin: number,
    avgLoss: number,
    bankroll: number
  ): number {
    // Kelly Formula: f* = (p*b - q) / b
    // where p = win rate, q = loss rate, b = win/loss ratio
    const lossRate = 1 - winRate;
    const winLossRatio = avgWin / avgLoss;
    const kellyFraction = (winRate * winLossRatio - lossRate) / winLossRatio;
    
    // Use half-Kelly for safety
    const halfKelly = Math.max(0, kellyFraction * 0.5);
    
    return bankroll * halfKelly;
  }

  /**
   * Track operational costs vs yield
   */
  calculateNetYield(costs: CostTracker): {
    gross: number;
    costs: number;
    net: number;
    breakevenAum: number;
  } {
    const dailyCosts = costs.dailyApiCosts + costs.dailyComputeCosts + costs.dailyTransactionCosts;
    const annualCosts = dailyCosts * 365;
    const annualGross = costs.grossYield * 365;
    const annualNet = annualGross - annualCosts;
    
    // Breakeven AUM = Annual Costs / Target APY
    const targetApy = 0.08; // 8%
    const breakevenAum = annualCosts / targetApy;

    return {
      gross: annualGross,
      costs: annualCosts,
      net: annualNet,
      breakevenAum,
    };
  }

  /**
   * Circuit breaker - should we halt operations?
   */
  shouldHalt(regime: MarketRegime, consecutiveLosses: number): boolean {
    // Halt if:
    // 1. Crisis regime and 3+ consecutive failed transactions
    // 2. Solana TPS < 500 (network issues)
    // 3. LST spreads > 5% (liquidity crisis)
    
    if (regime.solanaTps < 500) return true;
    if (regime.lstSpreads > 0.05) return true;
    if (consecutiveLosses >= 3) return true;
    
    return false;
  }
}
