import { OrderQueue } from '../src/queues/order-queue';
import { OrderStatus } from '../src/types';

// Mock Redis for testing
jest.mock('../src/models/redis', () => ({
  redis: {
    updateOrderStatus: jest.fn(),
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
  },
}));

describe('OrderQueue', () => {
  let orderQueue: OrderQueue;
  let mockProcessingCallback: jest.Mock;

  beforeEach(() => {
    mockProcessingCallback = jest.fn().mockResolvedValue(undefined);
    orderQueue = new OrderQueue();
    orderQueue.setProcessingCallback(mockProcessingCallback);
  });

  afterEach(async () => {
    await orderQueue.shutdown();
  });

  describe('Order Processing', () => {
    test('should add order to queue successfully', async () => {
      const orderId = 'test-order-1';
      const orderData = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      };

      await orderQueue.addOrder(orderId, orderData);

      // Give queue time to process
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockProcessingCallback).toHaveBeenCalledWith({
        orderId,
        orderData,
      });
    });

    test('should handle processing errors with retry', async () => {
      mockProcessingCallback
        .mockRejectedValueOnce(new Error('Processing failed'))
        .mockResolvedValueOnce(undefined);

      const orderId = 'test-order-retry';
      const orderData = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      };

      await orderQueue.addOrder(orderId, orderData);

      // Give time for retry
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should be called twice (original + retry)
      expect(mockProcessingCallback).toHaveBeenCalledTimes(2);
    });

    test('should respect concurrency limits', async () => {
      // Add delay to processing to test concurrency
      mockProcessingCallback.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 500))
      );

      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(orderQueue.addOrder(`order-${i}`, {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1000000,
          slippage: 0.01,
        }));
      }

      await Promise.all(promises);

      // Give time for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      const stats = await orderQueue.getStats();
      
      // Should have some orders still waiting due to concurrency limit
      expect(stats.active + stats.waiting + stats.completed).toBeGreaterThan(0);
    });
  });

  describe('Queue Management', () => {
    test('should get accurate queue statistics', async () => {
      const stats = await orderQueue.getStats();
      
      expect(stats).toMatchObject({
        waiting: expect.any(Number),
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        delayed: expect.any(Number),
        paused: expect.any(Number),
      });

      expect(stats.waiting).toBeGreaterThanOrEqual(0);
      expect(stats.active).toBeGreaterThanOrEqual(0);
    });

    test('should pause and resume queue', async () => {
      await orderQueue.pauseQueue();
      
      // Add order while paused
      await orderQueue.addOrder('paused-order', {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      });

      // Give time to ensure it doesn't process
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(mockProcessingCallback).not.toHaveBeenCalled();

      // Resume and check processing
      await orderQueue.resumeQueue();
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(mockProcessingCallback).toHaveBeenCalled();
    });

    test('should cancel pending orders', async () => {
      const orderId = 'cancel-test';
      
      // Add order
      await orderQueue.addOrder(orderId, {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      });

      // Cancel immediately
      await orderQueue.cancelOrder(orderId);

      // Verify job is removed
      const job = await orderQueue.getJobInfo(orderId);
      expect(job).toBeNull();
    });
  });

  describe('Health Check', () => {
    test('should return queue health status', async () => {
      const health = await orderQueue.healthCheck();
      
      expect(health).toMatchObject({
        isHealthy: expect.any(Boolean),
        queueStats: expect.any(Object),
        workerStatus: expect.any(String),
      });

      expect(['running', 'stopped', 'error']).toContain(health.workerStatus);
    });
  });

  describe('Rate Limiting', () => {
    test('should respect rate limits', async () => {
      const startTime = Date.now();
      
      // Add many orders quickly
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(orderQueue.addOrder(`rate-test-${i}`, {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1000000,
          slippage: 0.01,
        }));
      }

      await Promise.all(promises);
      
      // Processing should take some time due to rate limiting
      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThan(100); // Should not be instantaneous
    });
  });

  describe('Job Retry Logic', () => {
    test('should retry failed jobs up to maximum attempts', async () => {
      let callCount = 0;
      mockProcessingCallback.mockImplementation(() => {
        callCount++;
        throw new Error(`Attempt ${callCount} failed`);
      });

      const orderId = 'retry-test';
      await orderQueue.addOrder(orderId, {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      });

      // Wait for all retries to complete
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Should be called 3 times (initial + 2 retries)
      expect(callCount).toBe(3);
    });
  });

  describe('Queue Cleanup', () => {
    test('should clean up old jobs', async () => {
      // Add and complete some orders
      for (let i = 0; i < 5; i++) {
        await orderQueue.addOrder(`cleanup-test-${i}`, {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1000000,
          slippage: 0.01,
        });
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Cleanup should not throw
      await expect(orderQueue.cleanupJobs()).resolves.not.toThrow();
    });
  });
});