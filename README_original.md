# Order Execution Engine

A high-performance order execution system with DEX routing and real-time status updates. Routes orders between Raydium and Meteora DEXs for optimal execution prices.

## Overview

Market order execution engine that provides immediate execution at current market prices with intelligent routing between multiple DEX platforms.

## Features

- Multi-DEX routing with price comparison
- Real-time order status updates via WebSocket
- Concurrent order processing (10 concurrent, 100/minute)
- Queue-based order management with BullMQ
- Configurable slippage protection

## Architecture

### Execution Flow
```
POST /api/orders/execute → Validation → Queue → DEX Routing → Execution → Status Updates
```

### Tech Stack
- Node.js + TypeScript
- Fastify web framework
- BullMQ + Redis for queuing
- PostgreSQL for persistence
- Raydium + Meteora SDK integration

### Order States
- `pending` - Order queued for processing
- `routing` - Comparing DEX prices  
- `building` - Creating transaction
- `submitted` - Transaction sent to network
- `confirmed` - Execution successful
- `failed` - Execution failed

## DEX Routing

1. Parallel quote fetching from Raydium and Meteora
2. Price comparison including fees
3. Route selection based on optimal net outcome
4. Execution with transparent logging

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### Installation
```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

### Environment Variables
```env
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/orders_db
REDIS_URL=redis://localhost:6379
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=your_base58_private_key
DEFAULT_SLIPPAGE=0.01
```

## API Endpoints

### Execute Order

```http
POST /api/orders/execute
Content-Type: application/json

{
  "tokenIn": "So11111111111111111111111111111111111111112",  // SOL
  "tokenOut": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "amount": 1000000000,  // 1 SOL in lamports
  "slippage": 0.01       // 1% slippage tolerance
}
```

**Response:**
```json
{
  "orderId": "uuid-string",
  "status": "pending",
  "estimatedExecution": "2-5 seconds"
}
```

### WebSocket Connection

After receiving the order response, the HTTP connection upgrades to WebSocket:

```javascript
// Client-side WebSocket handling
const ws = new WebSocket('ws://localhost:3000/orders/uuid-string/status');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`Order ${update.orderId}: ${update.status}`);
  
  if (update.status === 'confirmed') {
    console.log(`Transaction: ${update.txHash}`);
    console.log(`Executed Price: ${update.executedPrice}`);
  }
};
```

## 🧪 Testing Strategy

### Unit Tests
- DEX router price comparison logic
- Order validation and queue management
- WebSocket lifecycle management
- Error handling and retry mechanisms

### Integration Tests
- End-to-end order execution flow
- Multi-DEX routing scenarios
- Concurrent order processing
- Database persistence verification

### Load Testing
- 100 orders/minute processing capacity
- 10 concurrent order execution
- WebSocket connection stability under load

## 🔧 Mock vs Real Implementation

### Mock Implementation (Default)
- Simulates DEX responses with realistic 200ms delays
- Price variations between DEXs (2-5% difference)
- Mock transaction execution (2-3 seconds)
- Focus on architecture and real-time updates

### Real Devnet Execution
- Actual Raydium/Meteora SDK integration
- Real transaction execution on Solana devnet
- Network latency and failure handling
- Requires devnet SOL from faucet

## 📈 Performance Metrics

- **Order Processing**: 100 orders/minute
- **Concurrent Execution**: Up to 10 simultaneous orders
- **Average Latency**: 2-5 seconds per order
- **Success Rate**: >95% (with retry logic)
- **WebSocket Updates**: Real-time (<100ms latency)

## 🚨 Error Handling

### Retry Strategy
- **Exponential Backoff**: 1s, 2s, 4s delays
- **Maximum Attempts**: 3 retries per order
- **Failure Persistence**: Store failure reasons for analysis

### Common Error Scenarios
- Insufficient balance
- High slippage conditions
- Network connectivity issues
- DEX liquidity constraints

## 📋 Queue Management

### BullMQ Configuration
```javascript
// Queue settings
const queueOptions = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
};
```

## 🔗 Deployment

### Production Deployment
- **Hosting**: Railway/Heroku (free tier)
- **Database**: PostgreSQL (managed service)
- **Redis**: Redis Cloud (free tier)
- **Monitoring**: Built-in health checks

### Health Check Endpoint
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "queue": "processing",
  "timestamp": "2025-11-08T10:00:00Z"
}
```

## 📊 Monitoring & Logging

### Key Metrics
- Order processing times
- DEX routing decisions
- Success/failure rates
- Queue depth and processing speed

### Log Structure
```json
{
  "timestamp": "2025-11-08T10:00:00Z",
  "level": "info",
  "orderId": "uuid",
  "event": "dex_routing_decision",
  "data": {
    "raydiumPrice": 0.998,
    "meteoraPrice": 1.002,
    "selectedDex": "meteora",
    "reason": "better_price_after_fees"
  }
}
```

## 🧑‍💻 Development

### Project Structure
```
src/
├── controllers/     # API route handlers
├── services/        # Business logic (DEX router, order processor)
├── models/          # Database models and schemas
├── queues/          # BullMQ job processors
├── websocket/       # WebSocket connection management
├── utils/           # Helper functions and utilities
└── types/           # TypeScript type definitions
```

### Contributing
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Live Demo**: [https://your-deployed-app.railway.app](https://your-deployed-app.railway.app)
- **Demo Video**: [https://youtu.be/your-video-id](https://youtu.be/your-video-id)
- **Postman Collection**: [Download here](./docs/postman-collection.json)
- **GitHub Repository**: [https://github.com/yourusername/order-execution-engine](https://github.com/yourusername/order-execution-engine)

---

**Built with ❤️ for efficient DeFi order execution**