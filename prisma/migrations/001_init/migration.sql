-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "slippage" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "selectedDex" TEXT,
    "estimatedPrice" DOUBLE PRECISION,
    "executedPrice" DOUBLE PRECISION,
    "txHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "actualAmount" BIGINT,
    "gasUsed" BIGINT,
    "raydiumQuote" JSONB,
    "meteoraQuote" JSONB,
    "routingReason" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_logs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,
    "level" TEXT NOT NULL DEFAULT 'info',

    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_metrics" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordersProcessed" INTEGER NOT NULL DEFAULT 0,
    "ordersSucceeded" INTEGER NOT NULL DEFAULT 0,
    "ordersFailed" INTEGER NOT NULL DEFAULT 0,
    "averageExecTime" DOUBLE PRECISION,
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "activeConnections" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "system_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_orders_status" ON "orders"("status");
CREATE INDEX "idx_orders_created_at" ON "orders"("createdAt");
CREATE INDEX "idx_orders_token_pair" ON "orders"("tokenIn", "tokenOut");
CREATE INDEX "idx_execution_logs_order_id" ON "execution_logs"("orderId");
CREATE INDEX "idx_execution_logs_timestamp" ON "execution_logs"("timestamp");
CREATE INDEX "idx_execution_logs_event" ON "execution_logs"("event");