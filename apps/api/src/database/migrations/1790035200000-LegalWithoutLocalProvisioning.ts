import { MigrationInterface, QueryRunner } from 'typeorm';
export class LegalWithoutLocalProvisioning1790035200000 implements MigrationInterface {
  name = 'LegalWithoutLocalProvisioning1790035200000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE products SET provisioning_mode='none',updated_at=now() WHERE code='legal'",
    );
  }
  down(): Promise<void> {
    throw new Error('Forward-only: restore a verified backup for rollback');
  }
}
