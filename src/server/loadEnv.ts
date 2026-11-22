import dotenv from 'dotenv';
import path from 'path';

// Side-effect module: must be imported FIRST in server.ts before any DB module loads
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
