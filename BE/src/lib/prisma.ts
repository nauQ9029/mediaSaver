import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

// Set up the PostgreSQL connection pool
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Instantiate PrismaClient with the driver adapter
export const prisma = new PrismaClient({ adapter });