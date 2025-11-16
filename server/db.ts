import { drizzle } from 'drizzle-orm/neon-serverless';
import { processedEclis } from '@shared/schema';

const db = drizzle(process.env.DATABASE_URL!);

export { db, processedEclis };
