# Order Execution Engine

A sophisticated order execution system designed for decentralized exchanges (DEXs) on Solana. This engine automatically routes orders between Raydium and Meteora to find the best execution prices, providing real-time updates throughout the order lifecycle.

## What This Project Does

This system simulates a professional trading infrastructure that you might find at a crypto trading firm or DeFi protocol. It handles market orders (buy/sell at current market price) by:

1. **Accepting orders** from users via REST API
2. **Comparing prices** across multiple DEX platforms simultaneously  
3. **Routing to the best DEX** based on price and fees
4. **Executing trades** with slippage protection
5. **Providing real-time updates** on order status via WebSocket connections
6. **Managing high throughput** with concurrent processing and queuing

## Key Features

- **Smart DEX Routing**: Automatically finds the best prices between Raydium and Meteora
- **Real-time Updates**: WebSocket connections provide live order status updates
- **High Performance**: Processes up to 100 orders/minute with 10 concurrent executions
- **Queue Management**: BullMQ handles order queuing with retry logic and error handling
- **Slippage Protection**: Configurable limits prevent execution at unfavorable prices
- **Production Ready**: Complete with logging, monitoring, and deployment configurations

## How It Works

### Order Execution Workflow

```
User Submits Order → Validation → Queue → DEX Price Comparison → Route Selection → Execution → Real-time Updates
```

**Detailed Steps:**
1. **Order Submission**: User sends order via POST request with token pair, amount, and slippage tolerance
2. **Validation**: System validates token addresses, amounts, and slippage parameters
3. **Queuing**: Order enters BullMQ processing queue for concurrent handling
4. **Price Discovery**: System simultaneously queries Raydium and Meteora for best prices
5. **Route Selection**: Algorithm selects DEX with optimal price after factoring in fees
6. **Execution**: Transaction is built, signed, and submitted to the selected DEX
7. **Status Updates**: Real-time WebSocket messages inform user of progress
8. **Completion**: Final status with transaction hash and execution details

### Architecture Components

**Backend Infrastructure:**
- **Node.js + TypeScript**: Core runtime and type safety
- **Fastify**: High-performance web framework with built-in WebSocket support
- **BullMQ + Redis**: Queue management for concurrent order processing
- **PostgreSQL**: Persistent storage for order history and execution logs
- **Prisma ORM**: Type-safe database operations

**DEX Integration:**
- **Raydium SDK**: AMM pool interaction and price quotes
- **Meteora SDK**: Dynamic AMM integration for price comparison
- **Price Aggregation**: Intelligent routing based on best net execution price

### Order Lifecycle States

| State | Description | Duration |
|-------|-------------|----------|
| `pending` | Order received and queued | <1 second |
| `routing` | Comparing prices across DEX platforms | 1-2 seconds |
| `building` | Creating and signing transaction | 1 second |
| `submitted` | Transaction sent to Solana network | 1-2 seconds |
| `confirmed` | Execution successful with txHash | Final |
| `failed` | Execution failed with error details | Final |

## Getting Started

### Prerequisites
Before running this project, ensure you have:
- **Node.js 18+** installed
- **PostgreSQL 14+** running locally or accessible remotely
- **Redis 6+** for queue management and caching
- **Git** for cloning the repository

### Quick Start (Demo Mode)

For immediate testing without database setup:

```bash
# 1. Clone and install dependencies
git clone <repository-url>
cd order-execution-engine
npm install

# 2. Start the demo server (no database required)
node examples/demo-server.js

# 3. Open the demo interface in your browser
# Navigate to: examples/demo.html
```

The demo server runs in-memory simulation mode with realistic delays and price variations.

### Full Production Setup

For complete functionality with database persistence:

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your database and Redis credentials

# 3. Initialize database
npm run db:migrate
npm run db:generate

# 4. Start Redis server
redis-server

# 5. Run the application
npm run dev          # Development mode
npm run build && npm start  # Production mode
```

### Environment Configuration

Create a `.env` file with these required variables:

```env
# Server
PORT=3000
NODE_ENV=development

# Database  
DATABASE_URL=postgresql://postgres:password@localhost:5432/order_execution_engine
REDIS_URL=redis://localhost:6379

# Solana Network
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=your_base58_encoded_private_key_here

# Trading Parameters
DEFAULT_SLIPPAGE=0.01
MAX_CONCURRENT_ORDERS=10
ORDERS_PER_MINUTE=100
```

## Testing the System

### Interactive Demo

The easiest way to test the system:

1. **Start the demo server**: `node examples/demo-server.js`
2. **Open demo interface**: Navigate to `examples/demo.html` in your browser
3. **Submit orders**: Use the web interface to submit single or multiple orders
4. **Watch real-time updates**: See order status changes and execution details

**What you'll see in the demo:**
- Order submission and validation
- Real-time status updates: pending → routing → confirmed
- Price comparison between DEX routes  
- Execution times and transaction hashes
- Concurrent processing of multiple orders

### API Testing

**Submit an Order:**
```bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "So11111111111111111111111111111111111111112",
    "tokenOut": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 
    "amount": 1000000000,
    "slippage": 0.01
  }'
```

**Response:**
```json
{
  "orderId": "order_1762626819293_y57287x8h",
  "status": "pending",
  "estimatedExecution": "2-5 seconds",
  "order": {
    "id": "order_1762626819293_y57287x8h",
    "tokenIn": "So11111111111111111111111111111111111111112",
    "tokenOut": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1000000000,
    "slippage": 0.01,
    "status": "pending"
  }
}
```

**Check Order Status:**
```bash
curl http://localhost:3000/orders/{orderId}/status
```

**WebSocket Connection (for real-time updates):**
```javascript
const ws = new WebSocket('ws://localhost:3000/orders/{orderId}/status');
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`Order ${update.orderId}: ${update.status}`);
  
  if (update.status === 'confirmed') {
    console.log(`Transaction: ${update.txHash}`);
    console.log(`Executed Price: $${update.executedPrice}`);
  }
};
```

## Available Commands

### Development
```bash
npm run dev          # Start development server with hot reload
npm run build        # Compile TypeScript to JavaScript  
npm start            # Run production server
npm run lint         # Check code style and errors
```

### Database Management
```bash
npm run db:migrate   # Run database migrations
npm run db:generate  # Generate Prisma client
npm run db:studio    # Open Prisma Studio (database GUI)
```

### Testing
```bash
npm test                 # Run unit tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate test coverage report
```

## Performance Characteristics

**Throughput:**
- 100 orders per minute processing capacity
- Up to 10 concurrent order executions
- Sub-second order validation and queuing

**Execution Speed:**
- 2-5 seconds average order execution time
- Real-time WebSocket updates (<100ms latency)
- Parallel DEX price fetching (200ms per quote)

**Reliability:**
- Automatic retry with exponential backoff
- Comprehensive error handling and logging
- 95%+ success rate under normal conditions

## Project Structure

```
order-execution-engine/
├── src/                     # Source code
│   ├── controllers/         # API route handlers
│   ├── services/           # Business logic (DEX routing, order execution)
│   ├── queues/             # BullMQ job processing
│   ├── models/             # Database and Redis models
│   ├── websocket/          # WebSocket connection management
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Helper functions
├── tests/                  # Test suites
├── examples/               # Demo server and interface
├── prisma/                 # Database schema and migrations
├── .github/                # CI/CD workflows
└── docker-compose.yml      # Container orchestration
```

## Deployment Options

### Free Hosting Platforms

**Railway (Recommended for full-stack deployment):**
```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Deploy with database and Redis
railway login
railway link
railway up
```

**Render.com (Good for production-like setup):**
1. Connect your GitHub repository to Render
2. Use the included `render.yaml` configuration
3. Render will automatically provision PostgreSQL and Redis

**Vercel (For API-only deployment):**
```bash
# Deploy with Vercel CLI
npm install -g vercel
vercel --prod
```

### Docker (Local/VPS Deployment)
```bash
# Build and run with Docker Compose
docker-compose up --build

# Or build individual container
docker build -t order-execution-engine .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  order-execution-engine
```

### Traditional VPS Deployment
```bash
# Production build
npm run build

# Start with PM2 (process manager)
pm2 start dist/index.js --name order-engine

# Or direct Node.js
NODE_ENV=production npm start
```

### Live Demo
🚀 **Live Demo:** https://69105d198083303c88e46b04--orderexecutionsystem.netlify.app/  
🌐 **Repository:** https://github.com/RitesH000027/Eterna_Ritesh  
🖥️ **Local Demo:** `node examples/demo-server.js` → http://localhost:3000  

**Quick Test:**
```bash
git clone https://github.com/RitesH000027/Eterna_Ritesh
cd Eterna_Ritesh
node examples/demo-server.js
# Open examples/demo.html in browser
```

## Use Cases

This order execution engine is designed for:

- **DeFi Protocols**: Integration into AMM aggregators or trading interfaces  
- **Trading Firms**: High-frequency trading infrastructure for DEX arbitrage
- **Portfolio Management**: Automated rebalancing and execution services
- **Educational**: Learning advanced Node.js, queue management, and DeFi concepts
- **Research**: Studying DEX routing algorithms and execution optimization