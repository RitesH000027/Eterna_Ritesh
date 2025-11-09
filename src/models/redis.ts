import Redis from 'ioredis';
import { Order, OrderStatus, WebSocketMessage } from '../types';

export class RedisService {
  private redis: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.redis = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);
    this.publisher = new Redis(redisUrl);
  }

  async connect(): Promise<void> {
    // Test connections
    await this.redis.ping();
    await this.subscriber.ping();
    await this.publisher.ping();
  }

  async disconnect(): Promise<void> {
    await this.redis.disconnect();
    await this.subscriber.disconnect();
    await this.publisher.disconnect();
  }

  // Active order management
  async setActiveOrder(orderId: string, orderData: Order): Promise<void> {
    const key = `order:${orderId}`;
    await this.redis.setex(key, 3600, JSON.stringify(orderData)); // 1 hour TTL
  }

  async getActiveOrder(orderId: string): Promise<Order | null> {
    const key = `order:${orderId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async removeActiveOrder(orderId: string): Promise<void> {
    const key = `order:${orderId}`;
    await this.redis.del(key);
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, additionalData?: any): Promise<void> {
    const order = await this.getActiveOrder(orderId);
    if (order) {
      order.status = status;
      order.updatedAt = new Date();
      if (additionalData) {
        Object.assign(order, additionalData);
      }
      await this.setActiveOrder(orderId, order);
    }
  }

  // WebSocket messaging
  async publishOrderUpdate(orderId: string, message: WebSocketMessage): Promise<void> {
    const channel = `order:${orderId}:updates`;
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribeToOrderUpdates(orderId: string, callback: (message: WebSocketMessage) => void): Promise<void> {
    const channel = `order:${orderId}:updates`;
    
    this.subscriber.subscribe(channel);
    this.subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          const parsedMessage: WebSocketMessage = JSON.parse(message);
          callback(parsedMessage);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      }
    });
  }

  async unsubscribeFromOrderUpdates(orderId: string): Promise<void> {
    const channel = `order:${orderId}:updates`;
    await this.subscriber.unsubscribe(channel);
  }

  // Queue metrics and monitoring
  async incrementCounter(key: string, expireSeconds: number = 3600): Promise<number> {
    const result = await this.redis.incr(key);
    if (result === 1) {
      await this.redis.expire(key, expireSeconds);
    }
    return result;
  }

  async setGauge(key: string, value: number, expireSeconds: number = 3600): Promise<void> {
    await this.redis.setex(key, expireSeconds, value.toString());
  }

  async getGauge(key: string): Promise<number | null> {
    const value = await this.redis.get(key);
    return value ? parseFloat(value) : null;
  }

  // Connection tracking for WebSocket management
  async addConnection(orderId: string, connectionId: string): Promise<void> {
    const key = `connections:${orderId}`;
    await this.redis.sadd(key, connectionId);
    await this.redis.expire(key, 3600); // 1 hour TTL
  }

  async removeConnection(orderId: string, connectionId: string): Promise<void> {
    const key = `connections:${orderId}`;
    await this.redis.srem(key, connectionId);
  }

  async getConnections(orderId: string): Promise<string[]> {
    const key = `connections:${orderId}`;
    return await this.redis.smembers(key);
  }

  // Caching for DEX quotes (short-lived)
  async cacheQuote(cacheKey: string, quote: any, ttlSeconds: number = 30): Promise<void> {
    await this.redis.setex(cacheKey, ttlSeconds, JSON.stringify(quote));
  }

  async getCachedQuote(cacheKey: string): Promise<any | null> {
    const data = await this.redis.get(cacheKey);
    return data ? JSON.parse(data) : null;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}

export const redis = new RedisService();