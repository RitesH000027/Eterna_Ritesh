import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OrderExecutionService } from './services/order-execution';
import { OrderRequest, OrderStatus } from './types';

// Simple in-memory order storage for demo
const orders = new Map();
const mockOrderService = {
  async submitOrder(request: OrderRequest) {
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const order = {
      id: orderId,
      ...request,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    orders.set(orderId, order);
    
    // Simulate processing
    setTimeout(() => {
      order.status = OrderStatus.ROUTING;
      orders.set(orderId, order);
      
      setTimeout(() => {
        order.status = OrderStatus.CONFIRMED;
        order.executedPrice = 100.5 + Math.random() * 10;
        order.txHash = `tx_${Math.random().toString(36).substr(2, 16)}`;
        orders.set(orderId, order);
      }, 2000);
    }, 1000);
    
    return { orderId, order };
  },
  
  async getOrderStatus(orderId: string) {
    return orders.get(orderId);
  }
};

const server = Fastify({
  logger: true
});

// Health check
server.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      redis: 'connected',
      queue: 'processing',
      dex: 'available'
    }
  };
});

// Execute order
server.post('/api/orders/execute', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const body = request.body as any;
    
    // Basic validation
    if (!body.tokenIn || !body.tokenOut || !body.amount || !body.slippage) {
      reply.code(400).send({ error: 'Missing required fields' });
      return;
    }
    
    const { orderId, order } = await mockOrderService.submitOrder(body);
    
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
    reply.code(500).send({ error: 'Internal server error' });
  }
});

// Get order status
server.get('/api/orders/:orderId', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const params = request.params as { orderId: string };
    const order = await mockOrderService.getOrderStatus(params.orderId);
    
    if (!order) {
      reply.code(404).send({ error: 'Order not found' });
      return;
    }
    
    reply.send({ order });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error' });
  }
});

// Stats
server.get('/api/orders/stats', async (request: FastifyRequest, reply: FastifyReply) => {
  const allOrders = Array.from(orders.values());
  const confirmed = allOrders.filter(o => o.status === OrderStatus.CONFIRMED).length;
  const total = allOrders.length;
  
  reply.send({
    statistics: {
      totalOrders: total,
      successRate: total > 0 ? (confirmed / total) * 100 : 0,
      averageExecutionTime: 3000,
      ordersByStatus: {
        pending: allOrders.filter(o => o.status === OrderStatus.PENDING).length,
        routing: allOrders.filter(o => o.status === OrderStatus.ROUTING).length,
        confirmed: confirmed,
        failed: allOrders.filter(o => o.status === OrderStatus.FAILED).length,
      }
    }
  });
});

// API docs
server.get('/api/docs', async (request: FastifyRequest, reply: FastifyReply) => {
  return {
    title: 'Order Execution Engine API',
    version: '1.0.0',
    description: 'Simple demo API for order execution',
    endpoints: {
      'POST /api/orders/execute': 'Submit new order',
      'GET /api/orders/:orderId': 'Get order status',
      'GET /api/orders/stats': 'Get statistics',
      'GET /health': 'Health check'
    }
  };
});

// Root endpoint
server.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
  return {
    name: 'Order Execution Engine - Demo Mode',
    version: '1.0.0',
    status: 'operational',
    endpoints: [
      'GET /health',
      'GET /api/docs', 
      'POST /api/orders/execute',
      'GET /api/orders/:orderId',
      'GET /api/orders/stats'
    ]
  };
});

const start = async () => {
  try {
    console.log('🚀 Starting Order Execution Engine Demo...');
    
    await server.listen({
      port: 3000,
      host: '0.0.0.0'
    });
    
    console.log('✅ Server running on http://localhost:3000');
    console.log('📊 Health check: http://localhost:3000/health');
    console.log('📚 API docs: http://localhost:3000/api/docs');
    console.log('');
    console.log('🧪 Test with:');
    console.log('curl -X POST http://localhost:3000/api/orders/execute \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"tokenIn":"SOL","tokenOut":"USDC","amount":1000000000,"slippage":0.01}\'');
    
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();