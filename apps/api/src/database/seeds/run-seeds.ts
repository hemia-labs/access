import { AppDataSource } from '../../../data-source';
import { seedInitialAccess } from './001-initial-access';

async function run() {
  await AppDataSource.initialize();
  try {
    await seedInitialAccess(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
