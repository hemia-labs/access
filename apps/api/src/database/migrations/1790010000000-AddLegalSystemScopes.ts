import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLegalSystemScopes1790010000000 implements MigrationInterface {
  name = 'AddLegalSystemScopes1790010000000';
  async up(q: QueryRunner): Promise<void> {
    if (!q.isTransactionActive)
      throw new Error('Legal scope migration requires a transaction');
    // Exclusive locks protect the narrowly scoped historical backfill. No runtime bypass.
    await q.query(
      `LOCK TABLE system_roles, system_role_scopes, system_role_assignments, system_role_delegations, system_role_assignment_targets, system_role_delegation_targets IN ACCESS EXCLUSIVE MODE`,
    );
    await q.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM system_roles r JOIN products p ON p.id=r.product_id WHERE p.code<>'billing') THEN RAISE EXCEPTION 'Unexpected pre-Legal product catalog'; END IF; END $$`,
    );
    for (const table of [
      'system_roles',
      'system_role_scopes',
      'system_role_assignments',
      'system_role_delegations',
      'system_role_assignment_targets',
      'system_role_delegation_targets',
    ])
      await q.query(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_history`);
    // Remove only constraints whose keys are being expanded, leaving history and identity FKs intact.
    await q.query(`DO $$ DECLARE c record; BEGIN
      FOR c IN SELECT conrelid::regclass AS tab, conname FROM pg_constraint WHERE
        (conrelid IN ('system_role_assignment_targets'::regclass,'system_role_delegation_targets'::regclass) AND (contype IN ('p','c') OR (contype='f' AND confrelid IN ('system_role_assignments'::regclass,'system_role_delegations'::regclass)))) OR
        (conrelid IN ('system_role_assignments'::regclass,'system_role_delegations'::regclass) AND contype='f' AND confrelid='system_role_scopes'::regclass)
      LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tab,c.conname); END LOOP;
      FOR c IN SELECT conrelid::regclass AS tab,conname FROM pg_constraint WHERE conrelid='system_role_scopes'::regclass AND contype IN ('p','f','c')
      LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tab,c.conname); END LOOP;
    END $$`);
    await q.query(
      `ALTER TABLE system_roles ADD COLUMN scope_profile varchar(24)`,
    );
    await q.query(`UPDATE system_roles SET scope_profile='billing_v1'`);
    await q.query(
      `ALTER TABLE system_roles ALTER COLUMN scope_profile SET NOT NULL, ADD UNIQUE(id,scope_profile), ADD CHECK(scope_profile IN ('billing_v1','legal_v1'))`,
    );
    await q.query(
      `ALTER TABLE system_role_scopes ADD COLUMN scope_profile varchar(24), ADD COLUMN consumer_scope_type varchar(24)`,
    );
    await q.query(
      `UPDATE system_role_scopes SET scope_profile='billing_v1',consumer_scope_type='not_applicable'`,
    );
    await q.query(`ALTER TABLE system_role_scopes ALTER COLUMN scope_profile SET NOT NULL, ALTER COLUMN consumer_scope_type SET NOT NULL,
      ADD PRIMARY KEY(role_id,scope_type,consumer_scope_type), ADD FOREIGN KEY(role_id,scope_profile) REFERENCES system_roles(id,scope_profile),
      ADD CHECK((scope_profile='billing_v1' AND scope_type IN ('catalog_global','all_customers','organizations') AND consumer_scope_type='not_applicable') OR (scope_profile='legal_v1' AND scope_type IN ('legal_global','issuers','applications') AND consumer_scope_type IN ('not_applicable','all_organizations','organizations')))`);
    for (const kind of ['assignment', 'delegation']) {
      const parent = `system_role_${kind}s`,
        child = `system_role_${kind}_targets`;
      await q.query(
        `ALTER TABLE ${parent} ADD COLUMN consumer_scope_type varchar(24)`,
      );
      await q.query(
        `UPDATE ${parent} SET consumer_scope_type='not_applicable'`,
      );
      await q.query(
        `ALTER TABLE ${parent} ALTER COLUMN consumer_scope_type SET NOT NULL, ADD UNIQUE(id,scope_type,consumer_scope_type), ADD FOREIGN KEY(role_id,scope_type,consumer_scope_type) REFERENCES system_role_scopes(role_id,scope_type,consumer_scope_type)`,
      );
      await q.query(
        `ALTER TABLE ${child} ALTER COLUMN organization_id DROP NOT NULL, ALTER COLUMN scope_type DROP DEFAULT, ADD COLUMN consumer_scope_type varchar(24), ADD COLUMN target_type varchar(24), ADD COLUMN resource_id uuid`,
      );
      await q.query(
        `UPDATE ${child} SET consumer_scope_type='not_applicable',target_type='organization'`,
      );
      await q.query(`ALTER TABLE ${child} ALTER COLUMN consumer_scope_type SET NOT NULL, ALTER COLUMN target_type SET NOT NULL,
        ADD COLUMN target_id uuid GENERATED ALWAYS AS (COALESCE(organization_id,resource_id)) STORED,
        ADD PRIMARY KEY(${kind}_id,target_type,target_id),
        ADD FOREIGN KEY(${kind}_id,scope_type,consumer_scope_type) REFERENCES ${parent}(id,scope_type,consumer_scope_type),
        ADD CHECK((target_type='organization' AND organization_id IS NOT NULL AND resource_id IS NULL) OR (target_type IN ('legal_issuer','legal_application') AND organization_id IS NULL AND resource_id IS NOT NULL)),
        ADD CHECK((scope_type='organizations' AND consumer_scope_type='not_applicable' AND target_type='organization') OR (scope_type IN ('legal_global','issuers','applications') AND consumer_scope_type IN ('not_applicable','all_organizations','organizations') AND ((target_type='legal_issuer' AND scope_type='issuers') OR (target_type='legal_application' AND scope_type='applications') OR (target_type='organization' AND consumer_scope_type='organizations'))))`);
      await q.query(
        `CREATE INDEX ix_system_${kind}_targets_resource ON ${child}(target_type,target_id,${kind}_id)`,
      );
    }
    await q.query(`CREATE OR REPLACE FUNCTION seal_system_history() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE children integer; orgs integer; issuers integer; apps integer; product text;
    BEGIN
      IF TG_TABLE_NAME='system_roles' THEN
        SELECT p.code INTO product FROM products p WHERE p.id=NEW.product_id;
        IF NEW.scope_profile <> product || '_v1' THEN RAISE EXCEPTION 'Catalog profile does not match product' USING ERRCODE='23514'; END IF;
        SELECT count(*) INTO children FROM system_role_scopes WHERE role_id=NEW.id;
        IF children=0 THEN RAISE EXCEPTION 'Empty role scopes' USING ERRCODE='23514'; END IF;
      ELSE
        EXECUTE format('SELECT count(*) FILTER (WHERE target_type=''organization''), count(*) FILTER (WHERE target_type=''legal_issuer''), count(*) FILTER (WHERE target_type=''legal_application'') FROM %I WHERE %I=$1',TG_ARGV[0],TG_ARGV[1]) INTO orgs,issuers,apps USING NEW.id;
        IF (NEW.scope_type='organizations' OR NEW.consumer_scope_type='organizations') <> (orgs>0) OR
           (NEW.scope_type='issuers') <> (issuers>0) OR (NEW.scope_type='applications') <> (apps>0) THEN
          RAISE EXCEPTION 'Each scope dimension requires exactly its target kind' USING ERRCODE='23514';
        END IF;
      END IF;
      EXECUTE format('UPDATE %I SET sealed=true WHERE id=$1 AND NOT sealed',TG_TABLE_NAME) USING NEW.id;
      RETURN NULL;
    END $$`);
    for (const table of [
      'system_roles',
      'system_role_scopes',
      'system_role_assignments',
      'system_role_delegations',
      'system_role_assignment_targets',
      'system_role_delegation_targets',
    ])
      await q.query(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_history`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Forward-only authorization history migration: restore a verified pre-migration backup; never discard Legal grants',
      ),
    );
  }
}
