import Fastify, { FastifyInstance } from 'fastify';
import { orderController } from './controllers/order-controller';
import { webSocketService } from './websocket/websocket-service';
import { db } from './models/database';
import { redis } from './models/redis';
import { orderQueue } from './queues/order-queue';
import dotenv from 'dotenv';

dotenv.config();

export class Server {
  private fastify: FastifyInstance;
  private port: number;

  constructor() {
    this.port = parseInt(process.env.PORT || '3000');
    
    this.fastify = Fastify({
      logger: {
        level: process.env.LOG_LEVEL || 'info',
      },
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private async setupMiddleware(): Promise<void> {
    await this.fastify.register(import('@fastify/cors'), {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    });

    this.fastify.addHook('onRequest', async (request, reply) => {
      request.log.info({
        method: request.method,
        url: request.url,
        headers: request.headers,
      }, 'Incoming request');
    });

    this.fastify.addHook('onResponse', async (request, reply) => {
      request.log.info({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.getResponseTime(),
      }, 'Request completed');
    });

    // Error handler
    this.fastify.setErrorHandler((error, request, reply) => {
      request.log.error(error, 'Unhandled error');
      
      reply.status(500).send({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
      });
    });

    // Setup WebSocket
    await webSocketService.setupWebSocket(this.fastify);
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.fastify.get('/health', orderController.healthCheck.bind(orderController));
    
    // API documentation
    this.fastify.get('/api/docs', orderController.getApiDocs.bind(orderController));

    // Order routes
    this.fastify.register(async (fastify: FastifyInstance) => {
      // Execute order
      fastify.post('/api/orders/execute', orderController.executeOrder.bind(orderController));
      
      // Get order status
      fastify.get('/api/orders/:orderId', orderController.getOrderStatus.bind(orderController));
      
      // Cancel order
      fastify.delete('/api/orders/:orderId', orderController.cancelOrder.bind(orderController));
      
      // Execution statistics
      fastify.get('/api/orders/stats', orderController.getExecutionStats.bind(orderController));
    });

    // Root endpoint
    this.fastify.get('/', async (request, reply) => {
      return {
        name: 'Order Execution Engine',
        version: '1.0.0',
        description: 'High-performance order execution with DEX routing',
        endpoints: {
          health: '/health',
          documentation: '/api/docs',
          executeOrder: 'POST /api/orders/execute',
          orderStatus: 'GET /api/orders/:orderId',
          cancelOrder: 'DELETE /api/orders/:orderId',
          statistics: 'GET /api/orders/stats',
          websocket: 'WS /orders/:orderId/status',
        },
        status: 'operational',
        timestamp: new Date().toISOString(),
      };
    });

    // 404 handler
    this.fastify.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
        availableEndpoints: [
          'GET /',
          'GET /health',
          'GET /api/docs',
          'POST /api/orders/execute',
          'GET /api/orders/:orderId',
          'DELETE /api/orders/:orderId',
          'GET /api/orders/stats',
        ],
      });
    });
  }

  /**
   * Initialize all services
   */
  private async initializeServices(): Promise<void> {
    try {
      console.log('Initializing services...');

      // Connect to database
      await db.connect();
      console.log('✓ Database connected');

      // Connect to Redis
      await redis.connect();
      console.log('✓ Redis connected');

      // Additional service health checks
      const dexHealth = await require('./services/dex-router').dexRouter.healthCheck();
      console.log('✓ DEX router initialized:', dexHealth);

      const queueHealth = await orderQueue.healthCheck();
      console.log('✓ Order queue initialized:', queueHealth);

      console.log('All services initialized successfully');
    } catch (error) {
      console.error('Failed to initialize services:', error);
      throw error;
    }
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      // Initialize services first
      await this.initializeServices();

      // Start the Fastify server
      await this.fastify.listen({
        port: this.port,
        host: '0.0.0.0',
      });

      console.log(`🚀 Server running on port ${this.port}`);
      console.log(`📊 Health check: http://localhost:${this.port}/health`);
      console.log(`📚 API docs: http://localhost:${this.port}/api/docs`);
      console.log(`🔌 WebSocket: ws://localhost:${this.port}/orders/{orderId}/status`);

    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down server...');

    try {
      // Close order queue
      await orderQueue.shutdown();
      console.log('✓ Order queue closed');

      // Disconnect from Redis
      await redis.disconnect();
      console.log('✓ Redis disconnected');

      // Disconnect from database
      await db.disconnect();
      console.log('✓ Database disconnected');

      // Close Fastify server
      await this.fastify.close();
      console.log('✓ Server closed');

      console.log('Shutdown completed gracefully');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  /**
   * Get server instance (for testing)
   */
  getInstance(): FastifyInstance {
    return this.fastify;
  }
}

// Create server instance
const server = new Server();

// Handle shutdown signals
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  await server.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...');
  await server.shutdown();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export { server };