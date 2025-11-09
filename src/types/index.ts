export enum OrderStatus {
  PENDING = 'pending',
  ROUTING = 'routing',
  BUILDING = 'building',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

export enum DexProvider {
  RAYDIUM = 'raydium',
  METEORA = 'meteora'
}

export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
}

export interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  status: OrderStatus;
  selectedDex?: DexProvider;
  estimatedPrice?: number;
  executedPrice?: number;
  txHash?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DexQuote {
  price: number;
  fee: number;
  slippage: number;
  estimatedGas: number;
  provider: DexProvider;
}

export interface ExecutionResult {
  txHash: string;
  executedPrice: number;
  actualAmount: number;
  gasUsed: number;
  timestamp: Date;
}

export interface WebSocketMessage {
  orderId: string;
  status: OrderStatus;
  timestamp: Date;
  data?: {
    txHash?: string;
    executedPrice?: number;
    selectedDex?: DexProvider;
    errorMessage?: string;
    routingDecision?: {
      raydiumQuote: DexQuote;
      meteoraQuote: DexQuote;
      selectedProvider: DexProvider;
      reason: string;
    };
  };
}

export interface QueueJobData {
  orderId: string;
  orderData: OrderRequest;
}

export interface RoutingDecision {
  selectedDex: DexProvider;
  selectedQuote: DexQuote;
  alternativeQuote: DexQuote;
  reason: string;
  priceImprovement: number;
}