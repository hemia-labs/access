import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProtectSystemRoleBootstrap1790121600000 implements MigrationInterface {
  name = 'ProtectSystemRoleBootstrap1790121600000';
  async up(runner: QueryRunner) {
    await runner.query(`CREATE UNIQUE INDEX ux_system_role_bootstrap_product ON audit_events(resource_id)
      WHERE action='system_role.bootstrap' AND resource_type='product'`);
    await runner.query(`CREATE FUNCTION protect_system_role_bootstrap() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='TRUNCATE' THEN
          IF EXISTS(SELECT 1 FROM audit_events WHERE action='system_role.bootstrap' AND resource_type='product') THEN
            RAISE EXCEPTION 'Bootstrap receipt is immutable' USING ERRCODE='23514';
          END IF;
          RETURN NULL;
        END IF;
        IF OLD.action='system_role.bootstrap' AND OLD.resource_type='product' THEN
          RAISE EXCEPTION 'Bootstrap receipt is immutable' USING ERRCODE='23514';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        IF NEW.action='system_role.bootstrap' AND NEW.resource_type='product' THEN
          RAISE EXCEPTION 'Bootstrap receipt must be inserted' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER protect_system_role_bootstrap BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION protect_system_role_bootstrap()`);
    await runner.query(`CREATE TRIGGER protect_system_role_bootstrap_truncate BEFORE TRUNCATE ON audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION protect_system_role_bootstrap()`);
  }
  async down(runner: QueryRunner) {
    // Removing a consumed receipt would reopen the initialization exception.
    const [used] = (await runner.query(
      `SELECT EXISTS(SELECT 1 FROM audit_events WHERE action='system_role.bootstrap' AND resource_type='product') AS used`,
    )) as { used: boolean }[];
    if (used.used)
      throw new Error('Cannot revert a consumed bootstrap receipt');
    await runner.query(
      'DROP TRIGGER protect_system_role_bootstrap ON audit_events',
    );
    await runner.query(
      'DROP TRIGGER protect_system_role_bootstrap_truncate ON audit_events',
    );
    await runner.query('DROP FUNCTION protect_system_role_bootstrap()');
    await runner.query('DROP INDEX ux_system_role_bootstrap_product');
  }
}
