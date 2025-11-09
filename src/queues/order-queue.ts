import { Queue, Worker, Job } from 'bullmq';
import { QueueJobData, OrderStatus } from '../types';
import { redis } from '../models/redis';

export class OrderQueue {
  private queue: Queue<QueueJobData>;
  private worker: Worker<QueueJobData>;
  private processingCallback?: (jobData: QueueJobData) => Promise<void>;

  constructor() {
    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    };

    // Initialize queue with concurrency and retry settings
    this.queue = new Queue<QueueJobData>('order-execution', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
      },
    });

    // Initialize worker with concurrency limit
    this.worker = new Worker<QueueJobData>(
      'order-execution',
      async (job: Job<QueueJobData>) => {
        if (this.processingCallback) {
          await this.processingCallback(job.data);
        }
      },
      {
        connection,
        concurrency: 10, // Process up to 10 orders concurrently
        limiter: {
          max: 100,      // Process max 100 orders
          duration: 60000, // per minute (60 seconds)
        },
      }
    );

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for monitoring and logging
   */
  private setupEventListeners(): void {
    // Job progress tracking
    this.worker.on('active', (job: Job<QueueJobData>) => {
      console.log(`Processing order ${job.data.orderId}...`);
      redis.updateOrderStatus(job.data.orderId, OrderStatus.PENDING);
    });

    this.worker.on('completed', (job: Job<QueueJobData>) => {
      console.log(`Order ${job.data.orderId} completed successfully`);
      redis.incrementCounter('orders:completed:total');
      redis.incrementCounter(`orders:completed:${new Date().toISOString().split('T')[0]}`);
    });

    this.worker.on('failed', (job: Job<QueueJobData> | undefined, err: Error) => {
      if (job) {
        console.error(`Order ${job.data.orderId} failed:`, err.message);
        redis.updateOrderStatus(job.data.orderId, OrderStatus.FAILED, { 
          errorMessage: err.message 
        });
        redis.incrementCounter('orders:failed:total');
        redis.incrementCounter(`orders:failed:${new Date().toISOString().split('T')[0]}`);
      }
    });

    this.worker.on('progress', (job: Job<QueueJobData>, progress: number) => {
      console.log(`Order ${job.data.orderId} progress: ${progress}%`);
    });

    // Queue monitoring
    this.queue.on('waiting', (jobId: string) => {
      console.log(`Order job ${jobId} is waiting`);
    });

    this.queue.on('stalled', (jobId: string) => {
      console.warn(`Order job ${jobId} has stalled`);
    });
  }

  /**
   * Add an order to the processing queue
   */
  async addOrder(orderId: string, orderData: any, priority: number = 0): Promise<void> {
    const jobData: QueueJobData = {
      orderId,
      orderData,
    };

    await this.queue.add(
      'process-order',
      jobData,
      {
        priority,
        jobId: orderId, // Use orderId as job ID for deduplication
        delay: 0,       // Process immediately
      }
    );

    // Update queue depth metric
    const waiting = await this.queue.getWaiting();
    await redis.setGauge('queue:depth', waiting.length);

    console.log(`Added order ${orderId} to processing queue`);
  }

  /**
   * Set the callback function for processing orders
   */
  setProcessingCallback(callback: (jobData: QueueJobData) => Promise<void>): void {
    this.processingCallback = callback;
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }> {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
      this.queue.getPaused(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: paused.length,
    };
  }

  /**
   * Get detailed information about a specific job
   */
  async getJobInfo(orderId: string): Promise<Job<QueueJobData> | null> {
    return await this.queue.getJob(orderId);
  }

  /**
   * Retry a failed order
   */
  async retryOrder(orderId: string): Promise<void> {
    const job = await this.queue.getJob(orderId);
    if (job && job.failedReason) {
      await job.retry();
      console.log(`Retrying failed order ${orderId}`);
    } else {
      throw new Error(`Order ${orderId} not found or not in failed state`);
    }
  }

  /**
   * Cancel a pending order
   */
  async cancelOrder(orderId: string): Promise<void> {
    const job = await this.queue.getJob(orderId);
    if (job) {
      await job.remove();
      await redis.updateOrderStatus(orderId, OrderStatus.FAILED, {
        errorMessage: 'Order cancelled by user'
      });
      console.log(`Cancelled order ${orderId}`);
    } else {
      throw new Error(`Order ${orderId} not found in queue`);
    }
  }

  /**
   * Pause the queue (stop processing new jobs)
   */
  async pauseQueue(): Promise<void> {
    await this.queue.pause();
    console.log('Order queue paused');
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    await this.queue.resume();
    console.log('Order queue resumed');
  }

  /**
   * Clean up old completed and failed jobs
   */
  async cleanupJobs(): Promise<void> {
    // Remove completed jobs older than 24 hours
    await this.queue.clean(24 * 60 * 60 * 1000, 100, 'completed');
    
    // Remove failed jobs older than 7 days
    await this.queue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed');
    
    console.log('Queue cleanup completed');
  }

  /**
   * Get queue health status
   */
  async healthCheck(): Promise<{
    isHealthy: boolean;
    queueStats: any;
    workerStatus: string;
  }> {
    try {
      const stats = await this.getStats();
      const isHealthy = stats.active < 15 && stats.waiting < 50; // Thresholds for health
      
      return {
        isHealthy,
        queueStats: stats,
        workerStatus: this.worker.isRunning() ? 'running' : 'stopped',
      };
    } catch (error) {
      return {
        isHealthy: false,
        queueStats: null,
        workerStatus: 'error',
      };
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down order queue...');
    
    // Close worker first (stop accepting new jobs)
    await this.worker.close();
    
    // Close queue
    await this.queue.close();
    
    console.log('Order queue shutdown complete');
  }
}

export const orderQueue = new OrderQueue();