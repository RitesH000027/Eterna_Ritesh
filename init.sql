-- Initialize database for Order Execution Engine
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_token_pair ON orders(token_in, token_out);

-- Create indexes for execution logs
CREATE INDEX IF NOT EXISTS idx_execution_logs_order_id ON execution_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_timestamp ON execution_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_execution_logs_event ON execution_logs(event);