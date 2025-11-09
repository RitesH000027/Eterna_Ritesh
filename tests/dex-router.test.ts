import { MockDexRouter } from '../src/services/dex-router';
import { DexProvider } from '../src/types';

describe('DexRouter', () => {
  let dexRouter: MockDexRouter;

  beforeEach(() => {
    dexRouter = new MockDexRouter();
  });

  describe('Quote Fetching', () => {
    test('should fetch Raydium quote successfully', async () => {
      const quote = await dexRouter.getRaydiumQuote('SOL', 'USDC', 1000000);
      
      expect(quote).toMatchObject({
        price: expect.any(Number),
        fee: expect.any(Number),
        slippage: expect.any(Number),
        estimatedGas: expect.any(Number),
        provider: DexProvider.RAYDIUM,
      });
      
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBeGreaterThan(0);
      expect(quote.slippage).toBeGreaterThan(0);
    });

    test('should fetch Meteora quote successfully', async () => {
      const quote = await dexRouter.getMeteorQuote('SOL', 'USDC', 1000000);
      
      expect(quote).toMatchObject({
        price: expect.any(Number),
        fee: expect.any(Number),
        slippage: expect.any(Number),
        estimatedGas: expect.any(Number),
        provider: DexProvider.METEORA,
      });
      
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBeGreaterThan(0);
      expect(quote.slippage).toBeGreaterThan(0);
    });

    test('should handle API failures gracefully', async () => {
      // Test multiple calls to trigger simulated failures
      const promises = Array(20).fill(0).map(() => 
        dexRouter.getRaydiumQuote('SOL', 'USDC', 1000000)
      );

      const results = await Promise.allSettled(promises);
      const failures = results.filter(r => r.status === 'rejected');
      
      // Should have some failures due to reliability simulation
      expect(failures.length).toBeGreaterThan(0);
    });
  });

  describe('Route Selection', () => {
    test('should select best route between DEXs', async () => {
      const routingDecision = await dexRouter.getBestRoute('SOL', 'USDC', 1000000);
      
      expect(routingDecision).toMatchObject({
        selectedDex: expect.any(String),
        selectedQuote: expect.objectContaining({
          price: expect.any(Number),
          provider: expect.any(String),
        }),
        alternativeQuote: expect.objectContaining({
          price: expect.any(Number),
          provider: expect.any(String),
        }),
        reason: expect.any(String),
        priceImprovement: expect.any(Number),
      });

      expect([DexProvider.RAYDIUM, DexProvider.METEORA]).toContain(routingDecision.selectedDex);
    });

    test('should calculate price improvement correctly', async () => {
      const routingDecision = await dexRouter.getBestRoute('SOL', 'USDC', 1000000);
      
      expect(routingDecision.priceImprovement).toBeGreaterThanOrEqual(0);
    });

    test('should handle single DEX failure', async () => {
      // Mock one DEX to always fail
      jest.spyOn(dexRouter, 'getRaydiumQuote').mockRejectedValue(new Error('Raydium down'));
      
      const routingDecision = await dexRouter.getBestRoute('SOL', 'USDC', 1000000);
      
      expect(routingDecision.selectedDex).toBe(DexProvider.METEORA);
      expect(routingDecision.reason).toContain('unavailable');
    });

    test('should throw error when both DEXs fail', async () => {
      jest.spyOn(dexRouter, 'getRaydiumQuote').mockRejectedValue(new Error('Raydium down'));
      jest.spyOn(dexRouter, 'getMeteorQuote').mockRejectedValue(new Error('Meteora down'));
      
      await expect(dexRouter.getBestRoute('SOL', 'USDC', 1000000))
        .rejects.toThrow('All DEXs unavailable');
    });
  });

  describe('Swap Execution', () => {
    test('should execute swap successfully', async () => {
      const result = await dexRouter.executeSwap(
        DexProvider.RAYDIUM,
        'SOL',
        'USDC',
        1000000,
        0.01
      );

      expect(result).toMatchObject({
        txHash: expect.any(String),
        executedPrice: expect.any(Number),
        actualAmount: expect.any(Number),
        gasUsed: expect.any(Number),
        timestamp: expect.any(Date),
      });

      expect(result.txHash).toHaveLength(64); // Mock hash length
      expect(result.executedPrice).toBeGreaterThan(0);
      expect(result.actualAmount).toBeGreaterThan(0);
      expect(result.gasUsed).toBeGreaterThan(0);
    });

    test('should simulate execution failures', async () => {
      // Test multiple executions to trigger simulated failures
      const promises = Array(100).fill(0).map(() => 
        dexRouter.executeSwap(DexProvider.RAYDIUM, 'SOL', 'USDC', 1000000, 0.01)
      );

      const results = await Promise.allSettled(promises);
      const failures = results.filter(r => r.status === 'rejected');
      
      // Should have approximately 1% failure rate
      expect(failures.length).toBeGreaterThan(0);
    });
  });

  describe('Health Check', () => {
    test('should return health status for both DEXs', async () => {
      const health = await dexRouter.healthCheck();
      
      expect(health).toMatchObject({
        raydium: expect.any(Boolean),
        meteora: expect.any(Boolean),
        overall: expect.any(Boolean),
      });

      expect(health.overall).toBe(health.raydium || health.meteora);
    });
  });

  describe('Price Consistency', () => {
    test('should return consistent prices for same token pair', async () => {
      const [quote1, quote2] = await Promise.all([
        dexRouter.getRaydiumQuote('SOL', 'USDC', 1000000),
        dexRouter.getRaydiumQuote('SOL', 'USDC', 1000000),
      ]);

      // Prices should be within reasonable variance (±5%)
      const priceDiff = Math.abs(quote1.price - quote2.price) / quote1.price;
      expect(priceDiff).toBeLessThan(0.05);
    });
  });
});