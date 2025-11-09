import WebSocket from 'ws';
import { server } from '../src/server';
import { OrderStatus } from '../src/types';

describe('WebSocket Integration', () => {
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

  describe('Order Status WebSocket', () => {
    test('should establish WebSocket connection for order status', (done) => {
      const orderId = 'ws-test-order-1';
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/${orderId}/status`);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (error) => {
        done(error);
      });
    });

    test('should receive order status updates', (done) => {
      const orderId = 'ws-test-order-2';
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/${orderId}/status`);

      let messageCount = 0;
      const expectedMessages = [
        OrderStatus.PENDING,
        OrderStatus.ROUTING,
        OrderStatus.BUILDING,
        OrderStatus.SUBMITTED,
        OrderStatus.CONFIRMED,
      ];

      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        
        expect(message).toMatchObject({
          orderId: expect.any(String),
          status: expect.any(String),
          timestamp: expect.any(String),
        });

        messageCount++;
        
        if (messageCount >= 3) { // Received several status updates
          ws.close();
          done();
        }
      });

      ws.on('open', async () => {
        // Submit an order to trigger status updates
        const orderResponse = await fetch(`${serverUrl}/api/orders/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            amount: 1000000,
            slippage: 0.01,
          }),
        });

        expect(orderResponse.ok).toBe(true);
      });

      ws.on('error', (error) => {
        done(error);
      });
    }, 15000); // Longer timeout for order processing

    test('should handle client messages', (done) => {
      const orderId = 'ws-test-order-3';
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/${orderId}/status`);

      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        
        if (message.status === 'pong') {
          expect(message.orderId).toBe(orderId);
          ws.close();
          done();
        }
      });

      ws.on('open', () => {
        // Send ping message
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('error', (error) => {
        done(error);
      });
    });

    test('should handle connection close gracefully', (done) => {
      const orderId = 'ws-test-order-4';
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/${orderId}/status`);

      ws.on('open', () => {
        ws.close();
      });

      ws.on('close', (code, reason) => {
        expect(code).toBeGreaterThan(0);
        done();
      });

      ws.on('error', (error) => {
        done(error);
      });
    });
  });

  describe('Global WebSocket Stream', () => {
    test('should establish connection to global stream', (done) => {
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/stream`);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (error) => {
        done(error);
      });
    });

    test('should receive connection confirmation', (done) => {
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/stream`);

      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        
        expect(message).toMatchObject({
          orderId: 'global',
          status: 'connected',
          timestamp: expect.any(String),
          data: expect.objectContaining({
            message: 'Connected to global order stream',
          }),
        });

        ws.close();
        done();
      });

      ws.on('error', (error) => {
        done(error);
      });
    });
  });

  describe('WebSocket Error Handling', () => {
    test('should reject connection without order ID', (done) => {
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders//status`);

      ws.on('close', (code, reason) => {
        expect(code).toBe(1008); // Policy violation
        done();
      });

      ws.on('error', () => {
        // Expected for this test
        done();
      });
    });

    test('should handle invalid JSON messages', (done) => {
      const orderId = 'ws-error-test';
      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/${orderId}/status`);

      ws.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'error') {
          expect(message.message).toContain('Invalid message format');
          ws.close();
          done();
        }
      });

      ws.on('open', () => {
        // Send invalid JSON
        ws.send('invalid json{');
      });

      ws.on('error', (error) => {
        done(error);
      });
    });
  });

  describe('Multiple Connections', () => {
    test('should handle multiple connections for same order', (done) => {
      const orderId = 'ws-multi-test';
      const connections: WebSocket[] = [];
      let messagesReceived = 0;

      const createConnection = () => {
        const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/orders/${orderId}/status`);
        connections.push(ws);

        ws.on('message', (data: Buffer) => {
          const message = JSON.parse(data.toString());
          messagesReceived++;
          
          // If multiple connections received messages, test passes
          if (messagesReceived >= 2) {
            connections.forEach(conn => conn.close());
            done();
          }
        });

        return ws;
      };

      // Create multiple connections
      const ws1 = createConnection();
      const ws2 = createConnection();

      Promise.all([
        new Promise(resolve => ws1.on('open', resolve)),
        new Promise(resolve => ws2.on('open', resolve)),
      ]).then(async () => {
        // Submit order to trigger updates
        await fetch(`${serverUrl}/api/orders/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            amount: 1000000,
            slippage: 0.01,
          }),
        });
      });
    }, 10000);
  });
});