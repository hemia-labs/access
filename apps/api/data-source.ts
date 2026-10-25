import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { environmentFile } from './src/config/env-file';

dotenv.config({ path: environmentFile() });

const isProduction = process.env.NODE_ENV === 'production';
const ext = isProduction ? 'js' : 'ts';
const baseDir = isProduction ? 'dist/src' : 'src';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  synchronize: false,
  migrationsRun: false,
  extra: { options: '-c timezone=America/Mexico_City' },
  entities: [path.join(process.cwd(), `${baseDir}/**/*.entity.${ext}`)],
  migrations: [
    path.join(process.cwd(), `${baseDir}/database/migrations/*.${ext}`),
  ],
});
