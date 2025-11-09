import { v4 as uuidv4 } from 'uuid';
import { Order, OrderRequest, OrderStatus, WebSocketMessage, DexProvider } from '../types';
import { dexRouter } from './dex-router';
import { db } from '../models/database';
import { redis } from '../models/redis';
import { orderQueue } from '../queues/order-queue';

export class OrderExecutionService {
  constructor() {
    orderQueue.setProcessingCallback(this.processOrder.bind(this));
  }

  async submitOrder(orderRequest: OrderRequest): Promise<{ orderId: string; order: Order }> {
    this.validateOrderRequest(orderRequest);

    const orderId = uuidv4();
    const order: Order = {
      id: orderId,
      ...orderRequest,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const savedOrder = await db.createOrder(order);
      await redis.setActiveOrder(orderId, savedOrder);
      await orderQueue.addOrder(orderId, orderRequest);
      
      await db.logExecution(orderId, 'order_submitted', {
        tokenPair: `${orderRequest.tokenIn}-${orderRequest.tokenOut}`,
        amount: orderRequest.amount,
        slippage: orderRequest.slippage,
      });

      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.PENDING,
        timestamp: new Date(),
      });

      return { orderId, order: savedOrder };
    } catch (error) {
      console.error('Error submitting order:', error);
      throw new Error('Failed to submit order');
    }
  }

  /**
   * Process an order from the queue
   */
  private async processOrder(jobData: any): Promise<void> {
    const { orderId, orderData } = jobData;
    
    try {
      console.log(`Processing order ${orderId}...`);
      
      // Update status to routing
      await this.updateOrderStatus(orderId, OrderStatus.ROUTING);
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.ROUTING,
        timestamp: new Date(),
      });

      // Get quotes and routing decision
      const routingDecision = await dexRouter.getBestRoute(
        orderData.tokenIn,
        orderData.tokenOut,
        orderData.amount
      );

      console.log(`Order ${orderId} routing decision:`, {
        selectedDex: routingDecision.selectedDex,
        priceImprovement: routingDecision.priceImprovement,
        reason: routingDecision.reason,
      });

      // Log routing decision
      await db.logExecution(orderId, 'routing_decision', {
        selectedDex: routingDecision.selectedDex,
        raydiumPrice: routingDecision.alternativeQuote?.price || null,
        meteoraPrice: routingDecision.selectedQuote.price,
        priceImprovement: routingDecision.priceImprovement,
        reason: routingDecision.reason,
      });

      // Update order with routing info
      await db.updateOrder(orderId, {
        selectedDex: routingDecision.selectedDex,
        estimatedPrice: routingDecision.selectedQuote.price,
      });

      // Send routing update via WebSocket
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.ROUTING,
        timestamp: new Date(),
        data: {
          selectedDex: routingDecision.selectedDex,
          routingDecision: {
            raydiumQuote: routingDecision.alternativeQuote || routingDecision.selectedQuote,
            meteoraQuote: routingDecision.selectedQuote,
            selectedProvider: routingDecision.selectedDex,
            reason: routingDecision.reason,
          },
        },
      });

      // Update status to building
      await this.updateOrderStatus(orderId, OrderStatus.BUILDING);
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.BUILDING,
        timestamp: new Date(),
      });

      // Simulate transaction building delay
      await this.sleep(500 + Math.random() * 1000);

      // Update status to submitted
      await this.updateOrderStatus(orderId, OrderStatus.SUBMITTED);
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.SUBMITTED,
        timestamp: new Date(),
      });

      // Execute the swap
      const executionResult = await dexRouter.executeSwap(
        routingDecision.selectedDex,
        orderData.tokenIn,
        orderData.tokenOut,
        orderData.amount,
        orderData.slippage
      );

      console.log(`Order ${orderId} executed:`, {
        txHash: executionResult.txHash,
        executedPrice: executionResult.executedPrice,
        gasUsed: executionResult.gasUsed,
      });

      // Update order with execution results
      await db.updateOrder(orderId, {
        status: OrderStatus.CONFIRMED,
        executedPrice: executionResult.executedPrice,
        txHash: executionResult.txHash,
      });

      // Update Redis cache
      await this.updateOrderStatus(orderId, OrderStatus.CONFIRMED, {
        executedPrice: executionResult.executedPrice,
        txHash: executionResult.txHash,
      });

      // Log successful execution
      await db.logExecution(orderId, 'execution_completed', {
        txHash: executionResult.txHash,
        executedPrice: executionResult.executedPrice,
        actualAmount: executionResult.actualAmount,
        gasUsed: executionResult.gasUsed,
        executionTime: executionResult.timestamp,
      });

      // Send final success WebSocket update
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.CONFIRMED,
        timestamp: new Date(),
        data: {
          txHash: executionResult.txHash,
          executedPrice: executionResult.executedPrice,
        },
      });

      // Clean up Redis cache after successful completion
      setTimeout(() => redis.removeActiveOrder(orderId), 300000); // 5 minutes

    } catch (error) {
      console.error(`Order ${orderId} execution failed:`, error);
      
      // Update order status to failed
      await db.updateOrder(orderId, {
        status: OrderStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      await this.updateOrderStatus(orderId, OrderStatus.FAILED, {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      // Log execution failure
      await db.logExecution(orderId, 'execution_failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }, 'error');

      // Send failure WebSocket update
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.FAILED,
        timestamp: new Date(),
        data: {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error; // Re-throw for queue retry logic
    }
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId: string): Promise<Order | null> {
    // Try Redis first (faster)
    let order = await redis.getActiveOrder(orderId);
    
    if (!order) {
      // Fallback to database
      order = await db.getOrder(orderId);
    }
    
    return order;
  }

  /**
   * Cancel an order (if still pending)
   */
  async cancelOrder(orderId: string): Promise<void> {
    const order = await this.getOrderStatus(orderId);
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    if (order.status !== OrderStatus.PENDING) {
      throw new Error(`Cannot cancel order in ${order.status} state`);
    }

    try {
      // Remove from queue
      await orderQueue.cancelOrder(orderId);
      
      // Update status
      await db.updateOrder(orderId, {
        status: OrderStatus.FAILED,
        errorMessage: 'Cancelled by user',
      });

      await this.updateOrderStatus(orderId, OrderStatus.FAILED, {
        errorMessage: 'Cancelled by user',
      });

      // Log cancellation
      await db.logExecution(orderId, 'order_cancelled', {
        reason: 'user_requested',
      });

      // Send WebSocket update
      await this.sendWebSocketUpdate(orderId, {
        orderId,
        status: OrderStatus.FAILED,
        timestamp: new Date(),
        data: {
          errorMessage: 'Cancelled by user',
        },
      });

    } catch (error) {
      console.error(`Error cancelling order ${orderId}:`, error);
      throw new Error('Failed to cancel order');
    }
  }

  /**
   * Get execution statistics
   */
  async getExecutionStats(): Promise<{
    totalOrders: number;
    successRate: number;
    averageExecutionTime: number;
    ordersByStatus: Record<OrderStatus, number>;
  }> {
    const orders = await db.getRecentOrders(1000); // Last 1000 orders
    
    const totalOrders = orders.length;
    const successfulOrders = orders.filter(o => o.status === OrderStatus.CONFIRMED).length;
    const successRate = totalOrders > 0 ? (successfulOrders / totalOrders) * 100 : 0;

    // Calculate average execution time for confirmed orders
    const confirmedOrders = orders.filter(o => o.status === OrderStatus.CONFIRMED);
    const totalExecutionTime = confirmedOrders.reduce((sum, order) => {
      return sum + (order.updatedAt.getTime() - order.createdAt.getTime());
    }, 0);
    const averageExecutionTime = confirmedOrders.length > 0 
      ? totalExecutionTime / confirmedOrders.length 
      : 0;

    // Count orders by status
    const ordersByStatus = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {} as Record<OrderStatus, number>);

    return {
      totalOrders,
      successRate,
      averageExecutionTime,
      ordersByStatus,
    };
  }

  /**
   * Private helper methods
   */
  private validateOrderRequest(request: OrderRequest): void {
    if (!request.tokenIn || !request.tokenOut) {
      throw new Error('tokenIn and tokenOut are required');
    }
    
    if (request.tokenIn === request.tokenOut) {
      throw new Error('tokenIn and tokenOut must be different');
    }
    
    if (!request.amount || request.amount <= 0) {
      throw new Error('amount must be greater than 0');
    }
    
    if (!request.slippage || request.slippage < 0 || request.slippage > 0.5) {
      throw new Error('slippage must be between 0 and 0.5 (50%)');
    }
  }

  private async updateOrderStatus(orderId: string, status: OrderStatus, additionalData?: any): Promise<void> {
    await redis.updateOrderStatus(orderId, status, additionalData);
  }

  private async sendWebSocketUpdate(orderId: string, message: WebSocketMessage): Promise<void> {
    await redis.publishOrderUpdate(orderId, message);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const orderExecutionService = new OrderExecutionService();