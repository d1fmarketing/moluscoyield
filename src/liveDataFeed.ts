import axios from 'axios';

export interface LiveLSTData {
  symbol: string;
  mint: string;
  apy: number; // APY as decimal (e.g., 0.08 for 8%)
  price: number; // Price in USD
  tvl: number; // Total Value Locked in USD
  lastUpdated: Date;
}

export interface KaminoVault {
  id: string;
  name: string;
  strategy: string;
  apy: number;
  tvl: number;
  token: string;
  risk: 'low' | 'medium' | 'high';
}

export interface LivePriceData {
  solPrice: number;
  jitoSolPrice: number;
  mSolPrice: number;
  bSolPrice: number;
  lastUpdated: Date;
}

export class LiveDataFeed {
  private sanctumApi: string;
  private kaminoApi: string;
  private jupiterPriceApi: string;

  constructor() {
    this.sanctumApi = 'https://sanctum-extra-api.ngrok.dev';
    this.kaminoApi = 'https://api.kamino.finance';
    this.jupiterPriceApi = 'https://price.jup.ag/v6';
  }

  /**
   * Fetch real APYs from Sanctum API for LSTs
   * API: GET https://sanctum-extra-api.ngrok.dev/v1/apy/latest
   */
  async fetchLiveAPYs(): Promise<LiveLSTData[]> {
    try {
      const response = await axios.get(`${this.sanctumApi}/v1/apy/latest`, {
        timeout: 10000,
      });

      const apyData = response.data;
      
      // Map Sanctum data to our format
      const lstMappings: Record<string, { symbol: string; mint: string }> = {
        'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn' },
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So' },
        'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk': { symbol: 'bSOL', mint: 'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk' },
        '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': { symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm' },
      };

      const results: LiveLSTData[] = [];

      for (const [mint, data] of Object.entries(apyData)) {
        if (lstMappings[mint]) {
          // Convert basis points to decimal APY
          const apyData = data as { apy?: number };
          const apy = typeof apyData.apy === 'number' ? apyData.apy / 100 : 0.08;
          
          results.push({
            symbol: lstMappings[mint].symbol,
            mint: mint,
            apy: apy,
            price: 0, // Will be filled by fetchPrices
            tvl: 0,   // Would need additional API call
            lastUpdated: new Date(),
          });
        }
      }

      // Fetch prices for these LSTs
      const prices = await this.fetchPrices();
      
      // Enrich with price data
      results.forEach(lst => {
        if (lst.symbol === 'JitoSOL') lst.price = prices.jitoSolPrice;
        if (lst.symbol === 'mSOL') lst.price = prices.mSolPrice;
        if (lst.symbol === 'bSOL') lst.price = prices.bSolPrice;
        lst.price = lst.price || prices.solPrice * (1 + lst.apy * 0.1); // Approximation
      });

      return results.sort((a, b) => b.apy - a.apy);
    } catch (error) {
      console.error('Failed to fetch live APYs from Sanctum:', error);
      // Fallback to hardcoded values if API fails
      return this.getFallbackLSTData();
    }
  }

  /**
   * Fetch real prices from Jupiter Price API
   * API: GET https://price.jup.ag/v6/price?ids=SOL,J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn,mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So
   */
  async fetchPrices(): Promise<LivePriceData> {
    try {
      const response = await axios.get(`${this.jupiterPriceApi}/price`, {
        params: {
          ids: 'SOL,J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn,mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So,bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk',
        },
        timeout: 10000,
      });

      const data = response.data.data;

      return {
        solPrice: data.SOL?.price || 220,
        jitoSolPrice: data.J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn?.price || 240,
        mSolPrice: data.mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So?.price || 235,
        bSolPrice: data.bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk?.price || 230,
        lastUpdated: new Date(),
      };
    } catch (error) {
      console.error('Failed to fetch prices from Jupiter:', error);
      return {
        solPrice: 220,
        jitoSolPrice: 240,
        mSolPrice: 235,
        bSolPrice: 230,
        lastUpdated: new Date(),
      };
    }
  }

  /**
   * Fetch real Kamino vault data
   * API: GET https://api.kamino.finance/strategies
   */
  async fetchKaminoVaults(): Promise<KaminoVault[]> {
    try {
      const response = await axios.get(`${this.kaminoApi}/strategies`, {
        timeout: 10000,
      });

      const strategies = response.data;
      
      // Filter for Solana strategies with good APY
      const solanaStrategies = strategies
        .filter((s: any) => s.token === 'SOL' || s.token === 'JitoSOL' || s.token === 'mSOL')
        .filter((s: any) => s.apy > 0.05) // At least 5% APY
        .slice(0, 5); // Top 5

      return solanaStrategies.map((s: any) => ({
        id: s.id,
        name: s.name,
        strategy: s.strategyType || 'Lending',
        apy: s.apy,
        tvl: s.tvl || 0,
        token: s.token,
        risk: s.apy > 0.15 ? 'high' : s.apy > 0.10 ? 'medium' : 'low',
      }));
    } catch (error) {
      console.error('Failed to fetch Kamino vaults:', error);
      return this.getFallbackKaminoData();
    }
  }

  /**
   * Get comprehensive market data for decision making
   */
  async getMarketOverview(): Promise<{
    lstData: LiveLSTData[];
    kaminoVaults: KaminoVault[];
    prices: LivePriceData;
    bestOpportunity: { type: 'lst' | 'kamino'; data: any; apy: number };
  }> {
    const [lstData, kaminoVaults, prices] = await Promise.all([
      this.fetchLiveAPYs(),
      this.fetchKaminoVaults(),
      this.fetchPrices(),
    ]);

    // Find best opportunity
    const bestLST = lstData[0];
    const bestKamino = kaminoVaults[0];

    let bestOpportunity: { type: 'lst' | 'kamino'; data: any; apy: number };
    
    if (bestLST && bestKamino) {
      if (bestLST.apy >= bestKamino.apy) {
        bestOpportunity = { type: 'lst', data: bestLST, apy: bestLST.apy };
      } else {
        bestOpportunity = { type: 'kamino', data: bestKamino, apy: bestKamino.apy };
      }
    } else if (bestLST) {
      bestOpportunity = { type: 'lst', data: bestLST, apy: bestLST.apy };
    } else {
      bestOpportunity = { type: 'kamino', data: bestKamino, apy: bestKamino?.apy || 0.08 };
    }

    return {
      lstData,
      kaminoVaults,
      prices,
      bestOpportunity,
    };
  }

  private getFallbackLSTData(): LiveLSTData[] {
    return [
      { symbol: 'JitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', apy: 0.08, price: 240, tvl: 500000000, lastUpdated: new Date() },
      { symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', apy: 0.07, price: 235, tvl: 450000000, lastUpdated: new Date() },
      { symbol: 'bSOL', mint: 'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk', apy: 0.065, price: 230, tvl: 200000000, lastUpdated: new Date() },
      { symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', apy: 0.10, price: 250, tvl: 50000000, lastUpdated: new Date() },
    ];
  }

  private getFallbackKaminoData(): KaminoVault[] {
    return [
      { id: '1', name: 'JitoSOL Lending', strategy: 'Lending', apy: 0.12, tvl: 50000000, token: 'JitoSOL', risk: 'low' },
      { id: '2', name: 'mSOL Lending', strategy: 'Lending', apy: 0.10, tvl: 45000000, token: 'mSOL', risk: 'low' },
    ];
  }
}
