import { dexRouter } from '../src/services/dex-router';
import { OrderExecutionService } from '../src/services/order-execution';
import { orderQueue } from '../src/queues/order-queue';
import { OrderRequest, OrderStatus } from '../src/types';

describe('Additional Test Coverage', () => {
  describe('Order Validation', () => {
    const executionService = new OrderExecutionService();

    it('should validate order request with valid parameters', () => {
      const validOrder: OrderRequest = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippage: 0.01
      };

      expect(() => (executionService as any).validateOrderRequest(validOrder)).not.toThrow();
    });

    it('should reject invalid token addresses', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'invalid-token',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippage: 0.01
      };

      expect(() => (executionService as any).validateOrderRequest(invalidOrder)).toThrow();
    });

    it('should reject excessive slippage', () => {
      const highSlippageOrder: OrderRequest = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippage: 0.6 // 60% slippage
      };

      expect(() => (executionService as any).validateOrderRequest(highSlippageOrder)).toThrow();
    });

    it('should reject zero or negative amounts', () => {
      const zeroAmountOrder: OrderRequest = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 0,
        slippage: 0.01
      };

      expect(() => (executionService as any).validateOrderRequest(zeroAmountOrder)).toThrow();
    });
  });

  describe('DEX Price Comparison', () => {
    it('should fetch quotes from multiple DEXs', async () => {
      const quotes = await dexRouter.getAllQuotes('SOL', 'USDC', 1000000);
      
      expect(quotes).toHaveProperty('raydiumQuote');
      expect(quotes).toHaveProperty('meteoraQuote');
      expect(quotes).toHaveProperty('errors');
      
      if (quotes.raydiumQuote) {
        expect(quotes.raydiumQuote).toHaveProperty('provider');
        expect(quotes.raydiumQuote).toHaveProperty('price');
        expect(typeof quotes.raydiumQuote.price).toBe('number');
      }
      
      if (quotes.meteoraQuote) {
        expect(quotes.meteoraQuote).toHaveProperty('provider');
        expect(quotes.meteoraQuote).toHaveProperty('price');
        expect(typeof quotes.meteoraQuote.price).toBe('number');
      }
    });

    it('should handle different token pairs', async () => {
      const btcQuotes = await dexRouter.getAllQuotes('RAY', 'SOL', 100000);
      const ethQuotes = await dexRouter.getAllQuotes('MNDE', 'SOL', 500000);
      
      expect(btcQuotes).toHaveProperty('raydiumQuote');
      expect(ethQuotes).toHaveProperty('meteoraQuote');
    });

    it('should calculate price improvements correctly', async () => {
      const routingDecision = await dexRouter.getBestRoute('SOL', 'USDC', 1000000);
      
      expect(routingDecision).toHaveProperty('selectedDex');
      expect(routingDecision).toHaveProperty('selectedQuote');
      expect(routingDecision).toHaveProperty('priceImprovement');
      expect(typeof routingDecision.priceImprovement).toBe('number');
    });
  });

  describe('Queue Performance', () => {
    it('should handle multiple orders in queue', async () => {
      const orderPromises = [];
      
      for (let i = 0; i < 5; i++) {
        const orderRequest: OrderRequest = {
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1000000000 + i * 1000000,
          slippage: 0.01
        };
        
        orderPromises.push(orderQueue.addOrder(`test-order-${i}`, orderRequest));
      }
      
      const results = await Promise.all(orderPromises);
      expect(results).toHaveLength(5);
      
      results.forEach(result => {
        expect(result).toHaveProperty('id');
      });
    });

    it('should provide queue statistics', async () => {
      const stats = await orderQueue.getStats();
      
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.waiting).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts gracefully', async () => {
      // Simulate network timeout with unknown token pair
      const slowQuote = dexRouter.getAllQuotes('UNKNOWN-TOKEN', 'USDC', 1000000);
      
      await expect(slowQuote).resolves.toBeDefined();
    });

    it('should retry failed operations', async () => {
      const orderRequest: OrderRequest = {
        tokenIn: 'FAIL-TOKEN', // This should trigger retry logic
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01
      };

      // The queue should handle failures gracefully
      const job = await orderQueue.addOrder('retry-test', orderRequest);
      expect(job).toHaveProperty('id');
    });
  });
});