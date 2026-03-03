import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

let client: ReturnType<typeof createClient> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export const getDb = () => {
  if (!client) {
    client = createClient({
      url: process.env.DATABASE_URL!,
    });
  }
  if (!db) {
    db = drizzle(client, { schema });
  }
  return db;
};
