import { DexProvider, DexQuote, RoutingDecision } from '../types';

export class MockDexRouter {
  private readonly BASE_PRICES = new Map<string, number>([
    // Common token pairs with base prices
    ['SOL-USDC', 100.5],
    ['SOL-USDT', 100.8],
    ['USDC-USDT', 1.001],
    ['RAY-SOL', 0.025],
    ['MNDE-SOL', 0.012],
  ]);

  private readonly DEX_CONFIGS = {
    [DexProvider.RAYDIUM]: {
      baseFee: 0.0025, // 0.25%
      latencyRange: [150, 300], // ms
      priceVariance: 0.02, // ±2%
      reliabilityScore: 0.98,
    },
    [DexProvider.METEORA]: {
      baseFee: 0.002, // 0.2%
      latencyRange: [180, 250], // ms
      priceVariance: 0.025, // ±2.5%
      reliabilityScore: 0.96,
    },
  };

  /**
   * Simulates network delay for API calls
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generates a cache key for quote caching
   */
  private getQuoteCacheKey(tokenIn: string, tokenOut: string, amount: number, dex: DexProvider): string {
    return `quote:${dex}:${tokenIn}-${tokenOut}:${amount}`;
  }

  /**
   * Gets base price for a token pair
   */
  private getBasePrice(tokenIn: string, tokenOut: string): number {
    const pairKey = `${tokenIn}-${tokenOut}`;
    const reversePairKey = `${tokenOut}-${tokenIn}`;
    
    if (this.BASE_PRICES.has(pairKey)) {
      return this.BASE_PRICES.get(pairKey)!;
    } else if (this.BASE_PRICES.has(reversePairKey)) {
      return 1 / this.BASE_PRICES.get(reversePairKey)!;
    }
    
    // Fallback: generate pseudo-random but consistent price
    const hash = this.simpleHash(pairKey);
    return 0.1 + (hash % 1000) / 100; // Price between 0.1 and 10.1
  }

  /**
   * Simple hash function for consistent random values
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get quote from Raydium (mocked)
   */
  async getRaydiumQuote(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote> {
    const config = this.DEX_CONFIGS[DexProvider.RAYDIUM];
    
    // Simulate network delay
    const delay = config.latencyRange[0] + 
      Math.random() * (config.latencyRange[1] - config.latencyRange[0]);
    await this.sleep(delay);

    // Simulate occasional failures
    if (Math.random() > config.reliabilityScore) {
      throw new Error('Raydium API temporarily unavailable');
    }

    const basePrice = this.getBasePrice(tokenIn, tokenOut);
    
    // Add price variance
    const variance = (Math.random() - 0.5) * 2 * config.priceVariance;
    const adjustedPrice = basePrice * (1 + variance);
    
    // Calculate estimated gas (mock values)
    const estimatedGas = 5000 + Math.floor(Math.random() * 10000);
    
    return {
      price: adjustedPrice,
      fee: config.baseFee,
      slippage: 0.001 + Math.random() * 0.002, // 0.1-0.3% slippage
      estimatedGas,
      provider: DexProvider.RAYDIUM,
    };
  }

  /**
   * Get quote from Meteora (mocked)
   */
  async getMeteorQuote(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote> {
    const config = this.DEX_CONFIGS[DexProvider.METEORA];
    
    // Simulate network delay
    const delay = config.latencyRange[0] + 
      Math.random() * (config.latencyRange[1] - config.latencyRange[0]);
    await this.sleep(delay);

    // Simulate occasional failures
    if (Math.random() > config.reliabilityScore) {
      throw new Error('Meteora API temporarily unavailable');
    }

    const basePrice = this.getBasePrice(tokenIn, tokenOut);
    
    // Add price variance (typically slightly different from Raydium)
    const variance = (Math.random() - 0.5) * 2 * config.priceVariance;
    const adjustedPrice = basePrice * (1 + variance);
    
    // Calculate estimated gas (mock values)
    const estimatedGas = 4500 + Math.floor(Math.random() * 8000);
    
    return {
      price: adjustedPrice,
      fee: config.baseFee,
      slippage: 0.0005 + Math.random() * 0.0025, // 0.05-0.3% slippage
      estimatedGas,
      provider: DexProvider.METEORA,
    };
  }

  /**
   * Get quotes from both DEXs in parallel
   */
  async getAllQuotes(tokenIn: string, tokenOut: string, amount: number): Promise<{
    raydiumQuote: DexQuote | null;
    meteoraQuote: DexQuote | null;
    errors: string[];
  }> {
    const errors: string[] = [];
    let raydiumQuote: DexQuote | null = null;
    let meteoraQuote: DexQuote | null = null;

    // Fetch quotes in parallel
    const [raydiumResult, meteoraResult] = await Promise.allSettled([
      this.getRaydiumQuote(tokenIn, tokenOut, amount),
      this.getMeteorQuote(tokenIn, tokenOut, amount),
    ]);

    if (raydiumResult.status === 'fulfilled') {
      raydiumQuote = raydiumResult.value;
    } else {
      errors.push(`Raydium: ${raydiumResult.reason.message}`);
    }

    if (meteoraResult.status === 'fulfilled') {
      meteoraQuote = meteoraResult.value;
    } else {
      errors.push(`Meteora: ${meteoraResult.reason.message}`);
    }

    return { raydiumQuote, meteoraQuote, errors };
  }

  /**
   * Determines the best route based on net outcome (price - fees - slippage)
   */
  async getBestRoute(tokenIn: string, tokenOut: string, amount: number): Promise<RoutingDecision> {
    const { raydiumQuote, meteoraQuote, errors } = await this.getAllQuotes(tokenIn, tokenOut, amount);

    // If neither DEX is available, throw error
    if (!raydiumQuote && !meteoraQuote) {
      throw new Error(`All DEXs unavailable: ${errors.join(', ')}`);
    }

    // If only one DEX is available, use it
    if (!raydiumQuote) {
      return {
        selectedDex: DexProvider.METEORA,
        selectedQuote: meteoraQuote!,
        alternativeQuote: raydiumQuote!,
        reason: 'Raydium unavailable, using Meteora',
        priceImprovement: 0,
      };
    }

    if (!meteoraQuote) {
      return {
        selectedDex: DexProvider.RAYDIUM,
        selectedQuote: raydiumQuote,
        alternativeQuote: meteoraQuote!,
        reason: 'Meteora unavailable, using Raydium',
        priceImprovement: 0,
      };
    }

    // Calculate net outcomes (considering fees and slippage)
    const raydiumNetPrice = raydiumQuote.price * (1 - raydiumQuote.fee - raydiumQuote.slippage);
    const meteoraNetPrice = meteoraQuote.price * (1 - meteoraQuote.fee - meteoraQuote.slippage);

    const isRaydiumBetter = raydiumNetPrice > meteoraNetPrice;
    const priceImprovement = Math.abs(raydiumNetPrice - meteoraNetPrice) / Math.min(raydiumNetPrice, meteoraNetPrice);

    if (isRaydiumBetter) {
      return {
        selectedDex: DexProvider.RAYDIUM,
        selectedQuote: raydiumQuote,
        alternativeQuote: meteoraQuote,
        reason: `Better net price: ${raydiumNetPrice.toFixed(6)} vs ${meteoraNetPrice.toFixed(6)}`,
        priceImprovement: priceImprovement * 100, // Convert to percentage
      };
    } else {
      return {
        selectedDex: DexProvider.METEORA,
        selectedQuote: meteoraQuote,
        alternativeQuote: raydiumQuote,
        reason: `Better net price: ${meteoraNetPrice.toFixed(6)} vs ${raydiumNetPrice.toFixed(6)}`,
        priceImprovement: priceImprovement * 100, // Convert to percentage
      };
    }
  }

  /**
   * Simulates swap execution on the selected DEX
   */
  async executeSwap(dex: DexProvider, tokenIn: string, tokenOut: string, amount: number, maxSlippage: number): Promise<{
    txHash: string;
    executedPrice: number;
    actualAmount: number;
    gasUsed: number;
    timestamp: Date;
  }> {
    // Simulate execution delay (2-3 seconds)
    const executionTime = 2000 + Math.random() * 1000;
    await this.sleep(executionTime);

    // Simulate execution failure (1% chance)
    if (Math.random() < 0.01) {
      throw new Error(`Execution failed on ${dex}: Insufficient liquidity or network congestion`);
    }

    // Get fresh quote for execution price calculation
    const quote = dex === DexProvider.RAYDIUM 
      ? await this.getRaydiumQuote(tokenIn, tokenOut, amount)
      : await this.getMeteorQuote(tokenIn, tokenOut, amount);

    // Simulate price movement during execution (within slippage tolerance)
    const slippageImpact = (Math.random() - 0.5) * maxSlippage * 2;
    const executedPrice = quote.price * (1 + slippageImpact);
    const actualAmount = amount * executedPrice;

    // Generate mock transaction hash
    const txHash = this.generateMockTxHash();

    // Mock gas usage
    const gasUsed = quote.estimatedGas * (0.9 + Math.random() * 0.2); // ±10% variance

    return {
      txHash,
      executedPrice,
      actualAmount,
      gasUsed: Math.floor(gasUsed),
      timestamp: new Date(),
    };
  }

  /**
   * Generates a realistic-looking transaction hash
   */
  private generateMockTxHash(): string {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return hash;
  }

  /**
   * Health check for DEX connectivity
   */
  async healthCheck(): Promise<{
    raydium: boolean;
    meteora: boolean;
    overall: boolean;
  }> {
    const checks = await Promise.allSettled([
      this.getRaydiumQuote('SOL', 'USDC', 1000000), // Small test amount
      this.getMeteorQuote('SOL', 'USDC', 1000000),
    ]);

    const raydium = checks[0].status === 'fulfilled';
    const meteora = checks[1].status === 'fulfilled';

    return {
      raydium,
      meteora,
      overall: raydium || meteora,
    };
  }
}

export const dexRouter = new MockDexRouter();