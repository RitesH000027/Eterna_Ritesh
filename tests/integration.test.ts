import { server } from '../src/server';
import { OrderStatus } from '../src/types';

describe('API Integration Tests', () => {
  let serverInstance: any;
  let serverUrl: string;

  beforeAll(async () => {
    serverInstance = server.getInstance();
    await serverInstance.listen({ port: 0, host: 'localhost' });
    
    const address = serverInstance.server.address();
    const port = typeof address === 'string' ? address : address?.port;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await serverInstance.close();
  });

  describe('Order Execution Flow', () => {
    test('should complete full order execution lifecycle', async () => {
      // Step 1: Submit order
      const orderRequest = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippage: 0.01,
      };

      const submitResponse = await fetch(`${serverUrl}/api/orders/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest),
      });

      expect(submitResponse.status).toBe(201);
      
      const submitData = await submitResponse.json();
      expect(submitData).toMatchObject({
        orderId: expect.any(String),
        status: OrderStatus.PENDING,
        websocketUrl: expect.stringContaining('/orders/'),
        order: expect.objectContaining({
          id: expect.any(String),
          tokenIn: orderRequest.tokenIn,
          tokenOut: orderRequest.tokenOut,
          amount: orderRequest.amount,
          slippage: orderRequest.slippage,
        }),
      });

      const orderId = submitData.orderId;

      // Step 2: Check initial status
      const statusResponse = await fetch(`${serverUrl}/api/orders/${orderId}`);
      expect(statusResponse.status).toBe(200);
      
      const statusData = await statusResponse.json();
      expect(statusData.order.status).toBe(OrderStatus.PENDING);

      // Step 3: Wait for processing and check final status
      await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for execution

      const finalStatusResponse = await fetch(`${serverUrl}/api/orders/${orderId}`);
      expect(finalStatusResponse.status).toBe(200);
      
      const finalStatusData = await finalStatusResponse.json();
      expect([OrderStatus.CONFIRMED, OrderStatus.FAILED]).toContain(finalStatusData.order.status);

      if (finalStatusData.order.status === OrderStatus.CONFIRMED) {
        expect(finalStatusData.order).toMatchObject({
          executedPrice: expect.any(Number),
          txHash: expect.any(String),
          selectedDex: expect.any(String),
        });
      }
    }, 15000);

    test('should handle order cancellation', async () => {
      // Submit order
      const orderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      };

      const submitResponse = await fetch(`${serverUrl}/api/orders/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest),
      });

      const submitData = await submitResponse.json();
      const orderId = submitData.orderId;

      // Try to cancel immediately
      const cancelResponse = await fetch(`${serverUrl}/api/orders/${orderId}`, {
        method: 'DELETE',
      });

      // Should either succeed or fail with appropriate message
      expect([200, 400, 404]).toContain(cancelResponse.status);
      
      if (cancelResponse.status === 200) {
        const cancelData = await cancelResponse.json();
        expect(cancelData.message).toContain('cancelled');
      }
    });
  });

  describe('Concurrent Order Processing', () => {
    test('should handle multiple simultaneous orders', async () => {
      const orderRequests = Array(5).fill(0).map((_, i) => ({
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000 + i,
        slippage: 0.01,
      }));

      // Submit all orders simultaneously
      const submitPromises = orderRequests.map(order =>
        fetch(`${serverUrl}/api/orders/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(order),
        })
      );

      const responses = await Promise.all(submitPromises);
      
      // All submissions should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Get all order IDs
      const orderData = await Promise.all(
        responses.map(response => response.json())
      );
      
      const orderIds = orderData.map(data => data.orderId);
      expect(orderIds).toHaveLength(5);
      expect(new Set(orderIds).size).toBe(5); // All unique

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check final statuses
      const statusPromises = orderIds.map(id =>
        fetch(`${serverUrl}/api/orders/${id}`)
      );

      const statusResponses = await Promise.all(statusPromises);
      const statusData = await Promise.all(
        statusResponses.map(response => response.json())
      );

      // All orders should be in final state (confirmed or failed)
      statusData.forEach(data => {
        expect([OrderStatus.CONFIRMED, OrderStatus.FAILED]).toContain(data.order.status);
      });

      // Most orders should succeed
      const confirmedCount = statusData.filter(data => 
        data.order.status === OrderStatus.CONFIRMED
      ).length;
      expect(confirmedCount).toBeGreaterThan(2);

    }, 20000);
  });

  describe('Input Validation', () => {
    test('should reject invalid order requests', async () => {
      const invalidRequests = [
        {}, // Empty object
        { tokenIn: 'SOL' }, // Missing fields
        { 
          tokenIn: 'SOL',
          tokenOut: 'SOL', // Same token
          amount: 1000000,
          slippage: 0.01,
        },
        {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: -1000000, // Negative amount
          slippage: 0.01,
        },
        {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1000000,
          slippage: 0.6, // Too high slippage
        },
      ];

      for (const invalidRequest of invalidRequests) {
        const response = await fetch(`${serverUrl}/api/orders/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invalidRequest),
        });

        expect(response.status).toBe(400);
        
        const errorData = await response.json();
        expect(errorData.error).toBeTruthy();
      }
    });

    test('should handle malformed JSON', async () => {
      const response = await fetch(`${serverUrl}/api/orders/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json{',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent order requests', async () => {
      const response = await fetch(`${serverUrl}/api/orders/non-existent-order-id`);
      
      expect(response.status).toBe(404);
      
      const errorData = await response.json();
      expect(errorData.error).toContain('not found');
    });

    test('should handle server errors gracefully', async () => {
      // This test would require mocking internal services to force errors
      // For now, we'll test the error response structure
      const response = await fetch(`${serverUrl}/api/orders/stats`);
      
      // Should either succeed or return proper error structure
      if (!response.ok) {
        const errorData = await response.json();
        expect(errorData).toMatchObject({
          error: expect.any(String),
        });
      }
    });
  });

  describe('API Documentation', () => {
    test('should serve API documentation', async () => {
      const response = await fetch(`${serverUrl}/api/docs`);
      
      expect(response.status).toBe(200);
      
      const docs = await response.json();
      expect(docs).toMatchObject({
        title: expect.any(String),
        version: expect.any(String),
        description: expect.any(String),
        endpoints: expect.any(Object),
      });
    });
  });

  describe('Health Check', () => {
    test('should return system health status', async () => {
      const response = await fetch(`${serverUrl}/health`);
      
      expect(response.status).toBe(200);
      
      const health = await response.json();
      expect(health).toMatchObject({
        status: expect.any(String),
        timestamp: expect.any(String),
        services: expect.objectContaining({
          database: expect.any(String),
          redis: expect.any(String),
          queue: expect.any(String),
          dex: expect.any(String),
        }),
      });
    });
  });

  describe('Performance Tests', () => {
    test('should handle orders within reasonable time limits', async () => {
      const orderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000000,
        slippage: 0.01,
      };

      const startTime = Date.now();
      
      const response = await fetch(`${serverUrl}/api/orders/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest),
      });

      const submitTime = Date.now() - startTime;
      
      expect(response.status).toBe(201);
      expect(submitTime).toBeLessThan(1000); // Should submit within 1 second

      const orderData = await response.json();
      const orderId = orderData.orderId;

      // Wait for execution and measure total time
      const executionStart = Date.now();
      
      let finalStatus;
      let attempts = 0;
      const maxAttempts = 20; // 20 seconds max
      
      do {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const statusResponse = await fetch(`${serverUrl}/api/orders/${orderId}`);
        const statusData = await statusResponse.json();
        finalStatus = statusData.order.status;
        attempts++;
        
      } while (
        finalStatus === OrderStatus.PENDING || 
        finalStatus === OrderStatus.ROUTING ||
        finalStatus === OrderStatus.BUILDING ||
        finalStatus === OrderStatus.SUBMITTED &&
        attempts < maxAttempts
      );

      const totalExecutionTime = Date.now() - executionStart;
      
      // Should complete within reasonable time (10 seconds)
      expect(totalExecutionTime).toBeLessThan(10000);
      expect([OrderStatus.CONFIRMED, OrderStatus.FAILED]).toContain(finalStatus);
      
    }, 25000);
  });
});