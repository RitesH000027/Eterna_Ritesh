const fastify = require('fastify')({ 
  logger: true,
  disableRequestLogging: false 
});

// Enable CORS manually for browser requests
fastify.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
});

fastify.options('*', async (request, reply) => {
  return reply.code(200).send();
});

// Simple in-memory order storage for demo
const orders = new Map();

// Mock order service
const mockOrderService = {
  submitOrder: async (request) => {
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const order = {
      id: orderId,
      ...request,
      status: 'pending',
      executedPrice: null,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    orders.set(orderId, order);
    
    // Simulate processing
    setTimeout(() => {
      order.status = 'routing';
      orders.set(orderId, order);
      
      setTimeout(() => {
        order.status = 'confirmed';
        order.executedPrice = 100.5 + Math.random() * 10;
        order.txHash = `tx_${Math.random().toString(36).substr(2, 16)}`;
        orders.set(orderId, order);
      }, 2000);
    }, 1000);
    
    return { orderId, order };
  },
  
  getOrderStatus: async (orderId) => {
    return orders.get(orderId);
  }
};

// Health check
fastify.get('/health', async (request, reply) => {
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
fastify.post('/api/orders/execute', async (request, reply) => {
  try {
    const body = request.body;
    
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
fastify.get('/api/orders/:orderId', async (request, reply) => {
  try {
    const { orderId } = request.params;
    const order = await mockOrderService.getOrderStatus(orderId);
    
    if (!order) {
      reply.code(404).send({ error: 'Order not found' });
      return;
    }
    
    reply.send({ order });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error' });
  }
});

// Order status endpoint for WebSocket polling fallback
fastify.get('/orders/:orderId/status', async (request, reply) => {
  try {
    const { orderId } = request.params;
    const order = orders.get(orderId);
    
    if (!order) {
      reply.code(404).send({ error: 'Order not found' });
      return;
    }
    
    reply.send({ 
      orderId,
      status: order.status,
      order: {
        id: order.id,
        tokenIn: order.tokenIn,
        tokenOut: order.tokenOut,
        amount: order.amount,
        status: order.status,
        executedPrice: order.executedPrice,
        txHash: order.txHash,
        updatedAt: order.updatedAt
      }
    });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error' });
  }
});

// Stats
fastify.get('/api/orders/stats', async (request, reply) => {
  const allOrders = Array.from(orders.values());
  const confirmed = allOrders.filter(o => o.status === 'confirmed').length;
  const total = allOrders.length;
  
  reply.send({
    statistics: {
      totalOrders: total,
      successRate: total > 0 ? (confirmed / total) * 100 : 0,
      averageExecutionTime: 3000,
      ordersByStatus: {
        pending: allOrders.filter(o => o.status === 'pending').length,
        routing: allOrders.filter(o => o.status === 'routing').length,
        confirmed: confirmed,
        failed: allOrders.filter(o => o.status === 'failed').length,
      }
    }
  });
});

// API docs
fastify.get('/api/docs', async (request, reply) => {
  return {
    title: 'Order Execution Engine API - Demo Mode',
    version: '1.0.0',
    description: 'Simplified API demonstrating order execution flow',
    endpoints: {
      'POST /api/orders/execute': {
        description: 'Submit new order for execution',
        body: {
          tokenIn: 'string - Input token (e.g., SOL)',
          tokenOut: 'string - Output token (e.g., USDC)', 
          amount: 'number - Amount to swap',
          slippage: 'number - Slippage tolerance (0-0.5)'
        },
        response: {
          orderId: 'string - Unique order ID',
          status: 'string - Current status',
          order: 'object - Order details'
        }
      },
      'GET /api/orders/:orderId': {
        description: 'Get order status and details',
        response: {
          order: 'object - Complete order information'
        }
      },
      'GET /api/orders/stats': {
        description: 'Get execution statistics',
        response: {
          statistics: 'object - Performance metrics'
        }
      },
      'GET /health': {
        description: 'System health check',
        response: {
          status: 'string - System status',
          services: 'object - Service statuses'
        }
      }
    },
    example: {
      submit_order: {
        url: 'POST /api/orders/execute',
        body: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1000000000,
          slippage: 0.01
        }
      }
    }
  };
});

// Root endpoint
fastify.get('/', async (request, reply) => {
  return {
    name: '🚀 Order Execution Engine - Demo Mode',
    version: '1.0.0',
    description: 'Simplified order execution API for demonstration',
    status: 'operational',
    endpoints: [
      'GET /health - System health',
      'GET /api/docs - API documentation', 
      'POST /api/orders/execute - Submit order',
      'GET /api/orders/:orderId - Get order status',
      'GET /api/orders/stats - Statistics'
    ],
    demo_command: 'curl -X POST http://localhost:3000/api/orders/execute -H "Content-Type: application/json" -d \'{"tokenIn":"SOL","tokenOut":"USDC","amount":1000000000,"slippage":0.01}\''
  };
});

// Start server
const start = async () => {
  try {
    console.log('🚀 Starting Order Execution Engine Demo...');
    
    await fastify.listen({
      port: 3000,
      host: '0.0.0.0'
    });
    
    console.log('');
    console.log('✅ Server running on http://localhost:3000');
    console.log('📊 Health check: http://localhost:3000/health');
    console.log('📚 API docs: http://localhost:3000/api/docs');
    console.log('');
    console.log('🧪 Test order submission:');
    console.log('curl -X POST http://localhost:3000/api/orders/execute \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"tokenIn":"SOL","tokenOut":"USDC","amount":1000000000,"slippage":0.01}\'');
    console.log('');
    console.log('🌐 Open demo.html in your browser for interactive testing');
    
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();