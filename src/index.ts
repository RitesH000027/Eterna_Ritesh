import { server } from './server';

/**
 * Main entry point for the Order Execution Engine
 */
async function main(): Promise<void> {
  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main();
}