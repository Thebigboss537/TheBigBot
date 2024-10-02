import { logger } from './utils/logger';
import { initializeBot } from './bot';
import { connectDatabase } from './database';
import { startWebServer } from './web/server';

async function main() {
  try {
    const server = await startWebServer();

    await connectDatabase();
    logger.info('Connected to database');

    /*const bot = await initializeBot();
    logger.info('Bot initialized');*/

    

    // Manejo de cierre graceful
    process.on('SIGINT', async () => {
      
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error initializing application:', error);
    process.exit(1);
  }
}

main();