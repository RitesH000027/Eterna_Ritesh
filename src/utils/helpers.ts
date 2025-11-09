import { OrderStatus, DexProvider } from '../types';

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique identifier
 */
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate percentage change between two values
 */
export function calculatePercentageChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Format currency amounts for display
 */
export function formatCurrency(amount: number, decimals: number = 6): string {
  return amount.toFixed(decimals);
}

/**
 * Validate Solana address format
 */
export function isValidSolanaAddress(address: string): boolean {
  // Basic validation - should be base58 encoded and 32-44 characters
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  return address.length >= 32 && address.length <= 44 && base58Regex.test(address);
}

/**
 * Calculate slippage impact on price
 */
export function applySlippage(price: number, slippage: number, isPositive: boolean = true): number {
  const multiplier = isPositive ? (1 + slippage) : (1 - slippage);
  return price * multiplier;
}

/**
 * Format execution time for display
 */
export function formatExecutionTime(startTime: Date, endTime: Date): string {
  const diffMs = endTime.getTime() - startTime.getTime();
  if (diffMs < 1000) {
    return `${diffMs}ms`;
  } else if (diffMs < 60000) {
    return `${(diffMs / 1000).toFixed(2)}s`;
  } else {
    return `${(diffMs / 60000).toFixed(2)}m`;
  }
}

/**
 * Convert order status to human-readable description
 */
export function getStatusDescription(status: OrderStatus): string {
  const descriptions: Record<OrderStatus, string> = {
    [OrderStatus.PENDING]: 'Order received and queued for processing',
    [OrderStatus.ROUTING]: 'Comparing prices across DEX platforms',
    [OrderStatus.BUILDING]: 'Creating transaction for execution',
    [OrderStatus.SUBMITTED]: 'Transaction submitted to blockchain',
    [OrderStatus.CONFIRMED]: 'Order successfully executed',
    [OrderStatus.FAILED]: 'Order execution failed',
  };
  
  return descriptions[status] || 'Unknown status';
}

/**
 * Get DEX display name
 */
export function getDexDisplayName(dex: DexProvider): string {
  const names: Record<DexProvider, string> = {
    [DexProvider.RAYDIUM]: 'Raydium',
    [DexProvider.METEORA]: 'Meteora',
  };
  
  return names[dex] || dex;
}

/**
 * Calculate gas fee in SOL
 */
export function calculateGasFee(gasUsed: number, gasPrice: number = 5000): number {
  return (gasUsed * gasPrice) / 1e9; // Convert lamports to SOL
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  
  throw lastError!;
}

/**
 * Validate order request parameters
 */
export interface OrderValidation {
  isValid: boolean;
  errors: string[];
}

export function validateOrderRequest(request: any): OrderValidation {
  const errors: string[] = [];
  
  if (!request.tokenIn || typeof request.tokenIn !== 'string') {
    errors.push('tokenIn is required and must be a string');
  } else if (!isValidSolanaAddress(request.tokenIn)) {
    errors.push('tokenIn must be a valid Solana address');
  }
  
  if (!request.tokenOut || typeof request.tokenOut !== 'string') {
    errors.push('tokenOut is required and must be a string');
  } else if (!isValidSolanaAddress(request.tokenOut)) {
    errors.push('tokenOut must be a valid Solana address');
  }
  
  if (request.tokenIn === request.tokenOut) {
    errors.push('tokenIn and tokenOut must be different');
  }
  
  if (!request.amount || typeof request.amount !== 'number') {
    errors.push('amount is required and must be a number');
  } else if (request.amount <= 0) {
    errors.push('amount must be greater than 0');
  }
  
  if (!request.slippage || typeof request.slippage !== 'number') {
    errors.push('slippage is required and must be a number');
  } else if (request.slippage < 0 || request.slippage > 0.5) {
    errors.push('slippage must be between 0 and 0.5 (50%)');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Create a debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Create a throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Parse environment variable as number with default
 */
export function parseEnvNumber(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse environment variable as boolean with default
 */
export function parseEnvBoolean(envVar: string | undefined, defaultValue: boolean): boolean {
  if (!envVar) return defaultValue;
  return envVar.toLowerCase() === 'true';
}