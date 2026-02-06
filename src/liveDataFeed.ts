import axios from 'axios';

export interface LiveLSTData {
  symbol: string;
  mint: string;
  apy: number; // APY as decimal (e.g., 0.08 for 8%)
  price: number; // Price in USD
  tvl: number; // Total Value Locked in USD
  lastUpdated: Date;
  isFallback?: boolean; // Flag to indicate fallback data
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
  private defiLlamaApi: string;
  private jupiterPriceApi: string;

  constructor() {
    // REAL production endpoints
    this.sanctumApi = 'https://sanctum-s-api.fly.dev'; // Production Sanctum API
    this.defiLlamaApi = 'https://yields.llama.fi';
    this.jupiterPriceApi = 'https://price.jup.ag/v4'; // v4 is more stable
  }

  /**
   * Fetch real APYs from Sanctum production API
   * Fallback to DeFi Llama if Sanctum fails
   */
  async fetchLiveAPYs(): Promise<LiveLSTData[]> {
    const results: LiveLSTData[] = [];
    const timestamp = new Date();
    
    // Try Sanctum first
    try {
      console.log('📡 Fetching APYs from Sanctum (production)...');
      const response = await axios.get(`${this.sanctumApi}/v1/apy/latest`, {
        timeout: 15000,
        headers: {
          'Accept': 'application/json',
        }
      });

      const apyData = response.data;
      
      const lstMappings: Record<string, { symbol: string; mint: string }> = {
        'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn' },
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So' },
        'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk': { symbol: 'bSOL', mint: 'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk' },
        '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': { symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm' },
      };

      for (const [mint, data] of Object.entries(apyData)) {
        if (lstMappings[mint]) {
          const apyData = data as { apy?: number };
          const apy = typeof apyData.apy === 'number' ? apyData.apy / 100 : 0.08;
          
          results.push({
            symbol: lstMappings[mint].symbol,
            mint: mint,
            apy: apy,
            price: 0,
            tvl: 0,
            lastUpdated: timestamp,
            isFallback: false,
          });
        }
      }

      console.log(`✅ Sanctum: ${results.length} LSTs loaded`);

    } catch (sanctumError) {
      console.warn('⚠️  Sanctum API failed, trying DeFi Llama fallback...');
      
      // Fallback to DeFi Llama
      try {
        const llamaResponse = await axios.get(`${this.defiLlamaApi}/pools`, {
          timeout: 15000,
        });

        const pools = llamaResponse.data.data || [];
        
        // Filter for Solana LSTs
        const solanaLSTs = pools.filter((pool: any) => 
          pool.chain === 'Solana' && 
          (pool.project === 'jito' || pool.project === 'marinade' || pool.project === 'blaze')
        );

        for (const pool of solanaLSTs.slice(0, 4)) {
          const symbol = pool.symbol || 'Unknown';
          const mint = this.getMintFromSymbol(symbol);
          
          results.push({
            symbol,
            mint,
            apy: (pool.apy || 0) / 100,
            price: pool.price || 0,
            tvl: pool.tvlUsd || 0,
            lastUpdated: timestamp,
            isFallback: true, // Mark as fallback
          });
        }

        console.log(`⚠️  [FALLBACK - Sanctum unreachable] Loaded ${results.length} LSTs from DeFi Llama`);

      } catch (llamaError) {
        console.error('❌ Both APIs failed, using hardcoded fallback with warnings');
        return this.getFallbackLSTData(true);
      }
    }

    // Fetch prices to enrich data
    try {
      const prices = await this.fetchPrices();
      results.forEach(lst => {
        if (lst.symbol === 'JitoSOL') lst.price = prices.jitoSolPrice;
        if (lst.symbol === 'mSOL') lst.price = prices.mSolPrice;
        if (lst.symbol === 'bSOL') lst.price = prices.bSolPrice;
        if (lst.price === 0) lst.price = prices.solPrice * (1 + lst.apy * 0.1);
      });
    } catch (error) {
      console.warn('⚠️  Price fetch failed, using approximations');
    }

    return results.sort((a, b) => b.apy - a.apy);
  }

  /**
   * Map symbol to mint address
   */
  private getMintFromSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      'JitoSOL': 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
      'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      'bSOL': 'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk',
      'INF': '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm',
    };
    return mapping[symbol] || 'Unknown';
  }

  /**
   * Fetch real prices from Jupiter Price API v4
   */
  async fetchPrices(): Promise<LivePriceData> {
    try {
      console.log('📡 Fetching prices from Jupiter...');
      const response = await axios.get(`${this.jupiterPriceApi}/price`, {
        params: {
          ids: 'SOL,J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn,mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So,bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk',
        },
        timeout: 15000,
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
      console.warn('⚠️  Jupiter price API failed, using fallback prices');
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
   * Fetch Kamino vault data via DeFi Llama
   */
  async fetchKaminoVaults(): Promise<KaminoVault[]> {
    try {
      console.log('📡 Fetching Kamino vaults from DeFi Llama...');
      const response = await axios.get(`${this.defiLlamaApi}/pools`, {
        timeout: 15000,
      });

      const pools = response.data.data || [];
      
      // Filter for Kamino on Solana
      const kaminoPools = pools.filter((pool: any) => 
        pool.chain === 'Solana' && pool.project === 'kamino'
      );

      return kaminoPools.slice(0, 5).map((pool: any) => ({
        id: pool.pool || 'unknown',
        name: pool.symbol || 'Kamino Vault',
        strategy: pool.poolMeta || 'Lending',
        apy: (pool.apy || 0) / 100,
        tvl: pool.tvlUsd || 0,
        token: pool.symbol?.split('-')[0] || 'SOL',
        risk: (pool.apy || 0) > 15 ? 'high' : (pool.apy || 0) > 10 ? 'medium' : 'low',
      }));

    } catch (error) {
      console.warn('⚠️  [FALLBACK - DeFi Llama unreachable] Using hardcoded Kamino data');
      return this.getFallbackKaminoData();
    }
  }

  /**
   * Get comprehensive market data
   */
  async getMarketOverview() {
    const [lstData, prices] = await Promise.all([
      this.fetchLiveAPYs(),
      this.fetchPrices(),
    ]);

    // Kamino often fails, so we handle it separately
    let kaminoVaults: any[] = [];
    try {
      kaminoVaults = await this.fetchKaminoVaults();
    } catch (e) {
      console.warn('⚠️  Kamino fetch failed, continuing without vaults');
    }

    const bestLST = lstData[0];
    const bestKamino = kaminoVaults[0];

    let bestOpportunity;
    
    if (bestLST && bestKamino) {
      if (bestLST.apy >= bestKamino.apy) {
        bestOpportunity = { type: 'lst' as const, data: bestLST, apy: bestLST.apy };
      } else {
        bestOpportunity = { type: 'kamino' as const, data: bestKamino, apy: bestKamino.apy };
      }
    } else if (bestLST) {
      bestOpportunity = { type: 'lst' as const, data: bestLST, apy: bestLST.apy };
    } else {
      bestOpportunity = { type: 'kamino' as const, data: bestKamino, apy: bestKamino?.apy || 0.08 };
    }

    return {
      lstData,
      kaminoVaults,
      prices,
      bestOpportunity,
    };
  }

  private getFallbackLSTData(markAsFallback: boolean = false): LiveLSTData[] {
    console.warn(markAsFallback ? '⚠️  [FALLBACK - All APIs unreachable]' : 'Using default data');
    
    return [
      { symbol: 'JitoSOL', mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', apy: 0.08, price: 240, tvl: 500000000, lastUpdated: new Date(), isFallback: true },
      { symbol: 'mSOL', mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', apy: 0.07, price: 235, tvl: 450000000, lastUpdated: new Date(), isFallback: true },
      { symbol: 'bSOL', mint: 'bSo13r4TkiE4xumBojwQ4o6Aeok8HA5EoqmhJFs1Ffk', apy: 0.065, price: 230, tvl: 200000000, lastUpdated: new Date(), isFallback: true },
      { symbol: 'INF', mint: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', apy: 0.10, price: 250, tvl: 50000000, lastUpdated: new Date(), isFallback: true },
    ];
  }

  private getFallbackKaminoData(): KaminoVault[] {
    return [
      { id: '1', name: 'JitoSOL Lending', strategy: 'Lending', apy: 0.12, tvl: 50000000, token: 'JitoSOL', risk: 'low' },
      { id: '2', name: 'mSOL Lending', strategy: 'Lending', apy: 0.10, tvl: 45000000, token: 'mSOL', risk: 'low' },
    ];
  }
}
