import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';

const isCompiled = __filename.endsWith('.js');
const ext = isCompiled ? '.js' : '.ts';

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ??
    'postgres://payroll:payroll@localhost:5433/payroll',
  synchronize: false,
  logging: process.env.DATABASE_LOGGING === 'true',
  entities: [join(__dirname, '..', 'modules', '**', `*.entity${ext}`)],
  migrations: [join(__dirname, '..', 'database', 'migrations', `*${ext}`)],
});
