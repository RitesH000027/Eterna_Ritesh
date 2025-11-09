import { PrismaClient } from '@prisma/client';
import { Order as PrismaOrder } from '@prisma/client';
import { Order, OrderStatus, DexProvider } from '../types';

export class DatabaseService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    });
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async createOrder(orderData: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order> {
    const created = await this.prisma.order.create({
      data: {
        tokenIn: orderData.tokenIn,
        tokenOut: orderData.tokenOut,
        amount: BigInt(orderData.amount),
        slippage: orderData.slippage,
        status: orderData.status,
        selectedDex: orderData.selectedDex,
        estimatedPrice: orderData.estimatedPrice,
        executedPrice: orderData.executedPrice,
        txHash: orderData.txHash,
        errorMessage: orderData.errorMessage,
      },
    });

    return this.prismaOrderToOrder(created);
  }

  async updateOrder(id: string, updates: Partial<Order>): Promise<Order> {
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        ...updates,
        amount: updates.amount ? BigInt(updates.amount) : undefined,
        actualAmount: updates.actualAmount ? BigInt(updates.actualAmount) : undefined,
        updatedAt: new Date(),
      },
    });

    return this.prismaOrderToOrder(updated);
  }

  async getOrder(id: string): Promise<Order | null> {
    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    return order ? this.prismaOrderToOrder(order) : null;
  }

  async getOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    const orders = await this.prisma.order.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map(this.prismaOrderToOrder);
  }

  async getRecentOrders(limit: number = 100): Promise<Order[]> {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return orders.map(this.prismaOrderToOrder);
  }

  async logExecution(orderId: string, event: string, data?: any, level: string = 'info'): Promise<void> {
    await this.prisma.executionLog.create({
      data: {
        orderId,
        event,
        level,
        data: data ? JSON.stringify(data) : null,
      },
    });
  }

  async updateSystemMetrics(metrics: {
    ordersProcessed?: number;
    ordersSucceeded?: number;
    ordersFailed?: number;
    averageExecTime?: number;
    queueDepth?: number;
    activeConnections?: number;
  }): Promise<void> {
    await this.prisma.systemMetrics.create({
      data: {
        ...metrics,
      },
    });
  }

  private prismaOrderToOrder(prismaOrder: PrismaOrder): Order {
    return {
      id: prismaOrder.id,
      tokenIn: prismaOrder.tokenIn,
      tokenOut: prismaOrder.tokenOut,
      amount: Number(prismaOrder.amount),
      slippage: prismaOrder.slippage,
      status: prismaOrder.status as OrderStatus,
      selectedDex: prismaOrder.selectedDex as DexProvider | undefined,
      estimatedPrice: prismaOrder.estimatedPrice || undefined,
      executedPrice: prismaOrder.executedPrice || undefined,
      txHash: prismaOrder.txHash || undefined,
      errorMessage: prismaOrder.errorMessage || undefined,
      createdAt: prismaOrder.createdAt,
      updatedAt: prismaOrder.updatedAt,
    };
  }
}

export const db = new DatabaseService();