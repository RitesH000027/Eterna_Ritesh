import { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { redis } from '../models/redis';
import { WebSocketMessage } from '../types';

export class WebSocketService {
  private connections: Map<string, Set<WebSocket>> = new Map();

  /**
   * Setup WebSocket routes on Fastify instance
   */
  async setupWebSocket(fastify: FastifyInstance): Promise<void> {
    // Register WebSocket plugin
    await fastify.register(require('@fastify/websocket'));

    // WebSocket endpoint for order status updates
    fastify.register(async (fastify: FastifyInstance) => {
      fastify.get('/orders/:orderId/status', { websocket: true }, (connection: any, req: FastifyRequest) => {
        this.handleOrderStatusConnection(connection, req);
      });
    });

    // Global WebSocket endpoint for all order updates (admin/monitoring)
    fastify.register(async (fastify: FastifyInstance) => {
      fastify.get('/orders/stream', { websocket: true }, (connection: any, req: FastifyRequest) => {
        this.handleGlobalConnection(connection, req);
      });
    });
  }

  /**
   * Handle individual order status WebSocket connections
   */
  private async handleOrderStatusConnection(connection: any, req: FastifyRequest): Promise<void> {
    const params = req.params as { orderId: string };
    const orderId = params.orderId;
    
    if (!orderId) {
      connection.socket.close(1008, 'Order ID is required');
      return;
    }

    const socket: WebSocket = connection.socket;
    const connectionId = this.generateConnectionId();

    console.log(`WebSocket connection established for order ${orderId}`);

    try {
      // Add connection to tracking
      await this.addConnection(orderId, socket, connectionId);

      // Send current order status immediately
      await this.sendCurrentOrderStatus(orderId, socket);

      // Subscribe to Redis updates for this order
      await redis.subscribeToOrderUpdates(orderId, (message: WebSocketMessage) => {
        this.sendMessage(socket, message);
      });

      // Handle connection close
      socket.on('close', async () => {
        console.log(`WebSocket connection closed for order ${orderId}`);
        await this.removeConnection(orderId, connectionId);
        await redis.unsubscribeFromOrderUpdates(orderId);
      });

      // Handle connection errors
      socket.on('error', async (error) => {
        console.error(`WebSocket error for order ${orderId}:`, error);
        await this.removeConnection(orderId, connectionId);
        await redis.unsubscribeFromOrderUpdates(orderId);
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.pong();
      });

      // Optional: Handle client messages (for cancellation requests, etc.)
      socket.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(orderId, message, socket);
        } catch (error) {
          console.error('Error parsing client message:', error);
          this.sendError(socket, 'Invalid message format');
        }
      });

    } catch (error) {
      console.error(`Error setting up WebSocket for order ${orderId}:`, error);
      socket.close(1011, 'Server error');
    }
  }

  /**
   * Handle global monitoring WebSocket connections
   */
  private async handleGlobalConnection(connection: any, req: FastifyRequest): Promise<void> {
    const socket: WebSocket = connection.socket;
    
    console.log('Global WebSocket connection established');

    // This could be extended for admin monitoring
    // For now, we'll just send connection confirmation
    this.sendMessage(socket, {
      orderId: 'global',
      status: 'connected' as any,
      timestamp: new Date(),
      data: {
        message: 'Connected to global order stream'
      }
    });

    socket.on('close', () => {
      console.log('Global WebSocket connection closed');
    });

    socket.on('error', (error) => {
      console.error('Global WebSocket error:', error);
    });
  }

  /**
   * Handle messages from clients
   */
  private async handleClientMessage(orderId: string, message: any, socket: WebSocket): Promise<void> {
    switch (message.type) {
      case 'ping':
        this.sendMessage(socket, {
          orderId,
          status: 'pong' as any,
          timestamp: new Date(),
        });
        break;

      case 'cancel':
        // Handle cancellation request
        try {
          const { orderExecutionService } = require('../services/order-execution');
          await orderExecutionService.cancelOrder(orderId);
          
          this.sendMessage(socket, {
            orderId,
            status: 'cancelling' as any,
            timestamp: new Date(),
            data: { message: 'Cancellation requested' }
          });
        } catch (error) {
          this.sendError(socket, `Cancellation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        break;

      case 'status':
        // Send current status
        await this.sendCurrentOrderStatus(orderId, socket);
        break;

      default:
        this.sendError(socket, `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Send current order status to a WebSocket connection
   */
  private async sendCurrentOrderStatus(orderId: string, socket: WebSocket): Promise<void> {
    try {
      const order = await redis.getActiveOrder(orderId);
      
      if (order) {
        const message: WebSocketMessage = {
          orderId: order.id,
          status: order.status,
          timestamp: new Date(),
          data: {
            executedPrice: order.executedPrice,
            txHash: order.txHash,
            selectedDex: order.selectedDex,
            errorMessage: order.errorMessage,
          }
        };
        
        this.sendMessage(socket, message);
      } else {
        this.sendError(socket, 'Order not found');
      }
    } catch (error) {
      console.error(`Error sending current status for order ${orderId}:`, error);
      this.sendError(socket, 'Failed to retrieve order status');
    }
  }

  /**
   * Send a message to a WebSocket connection
   */
  private sendMessage(socket: WebSocket, message: WebSocketMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
      }
    }
  }

  /**
   * Send an error message to a WebSocket connection
   */
  private sendError(socket: WebSocket, errorMessage: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        const message = {
          type: 'error',
          message: errorMessage,
          timestamp: new Date(),
        };
        socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending WebSocket error:', error);
      }
    }
  }

  /**
   * Add a WebSocket connection to tracking
   */
  private async addConnection(orderId: string, socket: WebSocket, connectionId: string): Promise<void> {
    if (!this.connections.has(orderId)) {
      this.connections.set(orderId, new Set());
    }
    
    this.connections.get(orderId)!.add(socket);
    
    // Also track in Redis for cross-instance coordination
    await redis.addConnection(orderId, connectionId);
  }

  /**
   * Remove a WebSocket connection from tracking
   */
  private async removeConnection(orderId: string, connectionId: string): Promise<void> {
    const connections = this.connections.get(orderId);
    if (connections) {
      // Note: We'd need to track socket-to-connectionId mapping for proper removal
      // For simplicity, we'll clear all connections for this orderId when any disconnects
      if (connections.size <= 1) {
        this.connections.delete(orderId);
      }
    }
    
    // Remove from Redis tracking
    await redis.removeConnection(orderId, connectionId);
  }

  /**
   * Generate a unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Broadcast message to all connections for an order
   */
  async broadcastToOrder(orderId: string, message: WebSocketMessage): Promise<void> {
    const connections = this.connections.get(orderId);
    
    if (connections) {
      connections.forEach(socket => {
        this.sendMessage(socket, message);
      });
    }
    
    // Also publish to Redis for other instances
    await redis.publishOrderUpdate(orderId, message);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    activeOrders: number;
    connectionsPerOrder: Record<string, number>;
  } {
    let totalConnections = 0;
    const connectionsPerOrder: Record<string, number> = {};
    
    for (const [orderId, connections] of this.connections) {
      const count = connections.size;
      totalConnections += count;
      connectionsPerOrder[orderId] = count;
    }
    
    return {
      totalConnections,
      activeOrders: this.connections.size,
      connectionsPerOrder,
    };
  }

  /**
   * Clean up closed connections
   */
  cleanupConnections(): void {
    for (const [orderId, connections] of this.connections) {
      const activeConnections = new Set<WebSocket>();
      
      connections.forEach(socket => {
        if (socket.readyState === WebSocket.OPEN) {
          activeConnections.add(socket);
        }
      });
      
      if (activeConnections.size === 0) {
        this.connections.delete(orderId);
      } else {
        this.connections.set(orderId, activeConnections);
      }
    }
  }

  /**
   * Health check for WebSocket service
   */
  healthCheck(): {
    isHealthy: boolean;
    stats: any;
  } {
    const stats = this.getConnectionStats();
    
    return {
      isHealthy: true, // Could add more sophisticated health checks
      stats,
    };
  }
}

export const webSocketService = new WebSocketService();