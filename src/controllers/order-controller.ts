import { FastifyRequest, FastifyReply } from 'fastify';
import { orderExecutionService } from '../services/order-execution';
import { OrderRequest } from '../types';
import { z } from 'zod';

// Validation schemas
const OrderRequestSchema = z.object({
  tokenIn: z.string().min(1, 'tokenIn is required'),
  tokenOut: z.string().min(1, 'tokenOut is required'),
  amount: z.number().positive('amount must be positive'),
  slippage: z.number().min(0).max(0.5, 'slippage must be between 0 and 0.5'),
});

export class OrderController {
  /**
   * Execute a new order
   * POST /api/orders/execute
   */
  async executeOrder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      // Validate request body
      const validationResult = OrderRequestSchema.safeParse(request.body);
      
      if (!validationResult.success) {
        reply.code(400).send({
          error: 'Validation failed',
          details: validationResult.error.errors,
        });
        return;
      }

      const orderRequest: OrderRequest = validationResult.data;

      // Submit order for execution
      const { orderId, order } = await orderExecutionService.submitOrder(orderRequest);

      // Return order details
      reply.code(201).send({
        orderId,
        status: order.status,
        estimatedExecution: '2-5 seconds',
        websocketUrl: `/orders/${orderId}/status`,
        order: {
          id: order.id,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amount: order.amount,
          slippage: order.slippage,
          status: order.status,
          createdAt: order.createdAt,
        },
      });

    } catch (error) {
      console.error('Error executing order:', error);
      
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }

  /**
   * Get order status
   * GET /api/orders/:orderId
   */
  async getOrderStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const params = request.params as { orderId: string };
      const { orderId } = params;

      if (!orderId) {
        reply.code(400).send({
          error: 'Order ID is required',
        });
        return;
      }

      const order = await orderExecutionService.getOrderStatus(orderId);

      if (!order) {
        reply.code(404).send({
          error: 'Order not found',
        });
        return;
      }

      reply.send({
        order: {
          id: order.id,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amount: order.amount,
          slippage: order.slippage,
          status: order.status,
          selectedDex: order.selectedDex,
          estimatedPrice: order.estimatedPrice,
          executedPrice: order.executedPrice,
          txHash: order.txHash,
          errorMessage: order.errorMessage,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        },
      });

    } catch (error) {
      console.error('Error getting order status:', error);
      
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }

  /**
   * Cancel an order
   * DELETE /api/orders/:orderId
   */
  async cancelOrder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const params = request.params as { orderId: string };
      const { orderId } = params;

      if (!orderId) {
        reply.code(400).send({
          error: 'Order ID is required',
        });
        return;
      }

      await orderExecutionService.cancelOrder(orderId);

      reply.send({
        message: 'Order cancelled successfully',
        orderId,
      });

    } catch (error) {
      console.error('Error cancelling order:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          reply.code(404).send({
            error: 'Order not found',
          });
        } else if (error.message.includes('Cannot cancel')) {
          reply.code(400).send({
            error: error.message,
          });
        } else {
          reply.code(500).send({
            error: 'Internal server error',
            message: error.message,
          });
        }
      } else {
        reply.code(500).send({
          error: 'Internal server error',
          message: 'Unknown error occurred',
        });
      }
    }
  }

  /**
   * Get execution statistics
   * GET /api/orders/stats
   */
  async getExecutionStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const stats = await orderExecutionService.getExecutionStats();

      reply.send({
        statistics: {
          totalOrders: stats.totalOrders,
          successRate: stats.successRate,
          averageExecutionTime: stats.averageExecutionTime,
          ordersByStatus: stats.ordersByStatus,
        },
      });

    } catch (error) {
      console.error('Error getting execution stats:', error);
      
      reply.code(500).send({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  }

  /**
   * Health check endpoint
   * GET /health
   */
  async healthCheck(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      // Check various service health
      const [dexHealth, queueHealth, redisHealth] = await Promise.allSettled([
        require('../services/dex-router').dexRouter.healthCheck(),
        require('../queues/order-queue').orderQueue.healthCheck(),
        require('../models/redis').redis.healthCheck(),
      ]);

      const isHealthy = dexHealth.status === 'fulfilled' && 
                       queueHealth.status === 'fulfilled' && 
                       redisHealth.status === 'fulfilled';

      const status = isHealthy ? 'healthy' : 'degraded';

      reply.code(isHealthy ? 200 : 503).send({
        status,
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected', // Assume healthy for now
          redis: redisHealth.status === 'fulfilled' ? 'connected' : 'disconnected',
          queue: queueHealth.status === 'fulfilled' ? 'processing' : 'error',
          dex: dexHealth.status === 'fulfilled' ? 'available' : 'unavailable',
        },
        details: {
          dex: dexHealth.status === 'fulfilled' ? dexHealth.value : null,
          queue: queueHealth.status === 'fulfilled' ? queueHealth.value : null,
        },
      });

    } catch (error) {
      console.error('Health check error:', error);
      
      reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Health check failed',
      });
    }
  }

  /**
   * Get API documentation
   * GET /api/docs
   */
  async getApiDocs(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const apiDocs = {
      title: 'Order Execution Engine API',
      version: '1.0.0',
      description: 'API for executing orders with DEX routing and real-time updates',
      endpoints: {
        'POST /api/orders/execute': {
          description: 'Submit a new order for execution',
          body: {
            tokenIn: 'string (required) - Input token address',
            tokenOut: 'string (required) - Output token address', 
            amount: 'number (required) - Amount to swap',
            slippage: 'number (required) - Slippage tolerance (0-0.5)',
          },
          response: {
            orderId: 'string - Unique order identifier',
            status: 'string - Current order status',
            websocketUrl: 'string - WebSocket endpoint for live updates',
          },
        },
        'GET /api/orders/:orderId': {
          description: 'Get order status and details',
          params: {
            orderId: 'string (required) - Order ID',
          },
          response: {
            order: 'object - Complete order details',
          },
        },
        'DELETE /api/orders/:orderId': {
          description: 'Cancel a pending order',
          params: {
            orderId: 'string (required) - Order ID',
          },
        },
        'GET /api/orders/stats': {
          description: 'Get execution statistics',
          response: {
            statistics: 'object - Performance metrics',
          },
        },
        'GET /health': {
          description: 'Health check endpoint',
          response: {
            status: 'string - System health status',
            services: 'object - Individual service statuses',
          },
        },
        'WebSocket /orders/:orderId/status': {
          description: 'Real-time order status updates',
          messages: {
            status_update: 'Order lifecycle updates (pending → confirmed)',
            routing_decision: 'DEX routing information',
            execution_result: 'Final transaction details',
          },
        },
      },
      examples: {
        order_submission: {
          url: 'POST /api/orders/execute',
          body: {
            tokenIn: 'So11111111111111111111111111111111111111112',
            tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amount: 1000000000,
            slippage: 0.01,
          },
        },
        websocket_usage: {
          description: 'After submitting order, connect to WebSocket for live updates',
          code: `
const ws = new WebSocket('ws://localhost:3000/orders/{orderId}/status');
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Order status:', update.status);
};
          `,
        },
      },
    };

    reply.send(apiDocs);
  }
}

export const orderController = new OrderController();