import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemRoleAuthorization1789171200000 implements MigrationInterface {
  name = 'AddSystemRoleAuthorization1789171200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE system_roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sealed boolean NOT NULL DEFAULT false,
  product_id uuid NOT NULL REFERENCES products(id),
  code varchar(120) NOT NULL,
  name varchar(160) NOT NULL,
  description text,
  contract_version integer NOT NULL DEFAULT 1,
  catalog_version integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, code, catalog_version),
  CHECK (contract_version > 0 AND catalog_version > 0),
  CHECK (status IN ('active','disabled'))
)`);
    await queryRunner.query(`CREATE TABLE system_role_scopes (
  role_id uuid NOT NULL REFERENCES system_roles(id),
  scope_type varchar(24) NOT NULL,
  PRIMARY KEY (role_id, scope_type),
  CHECK (scope_type IN ('catalog_global','all_customers','organizations'))
)`);
    await queryRunner.query(`CREATE TABLE system_role_delegations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sealed boolean NOT NULL DEFAULT false,
  replaces_delegation_id uuid UNIQUE REFERENCES system_role_delegations(id),
  CHECK (replaces_delegation_id IS NULL OR replaces_delegation_id <> id),
  grantee_membership_id uuid NOT NULL REFERENCES organization_memberships(id),
  recipient_organization_id uuid NOT NULL REFERENCES organizations(id),
  idempotency_key uuid NOT NULL,
  UNIQUE (created_by_identity_id, idempotency_key),
  can_grant boolean NOT NULL DEFAULT false,
  can_revoke boolean NOT NULL DEFAULT false,
  role_id uuid NOT NULL,
  scope_type varchar(24) NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by_identity_id uuid NOT NULL REFERENCES identity_references(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_identity_id uuid REFERENCES identity_references(id),
  revoked_at timestamptz,
  FOREIGN KEY (role_id, scope_type) REFERENCES system_role_scopes(role_id, scope_type),
  UNIQUE (id, scope_type),
  CHECK (expires_at IS NULL OR expires_at > valid_from),
  CHECK (version > 0),
  CHECK ((status = 'active' AND revoked_at IS NULL AND revoked_by_identity_id IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_identity_id IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (can_grant OR can_revoke)
)`);
    await queryRunner.query(`CREATE TABLE system_role_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sealed boolean NOT NULL DEFAULT false,
  replaces_assignment_id uuid UNIQUE REFERENCES system_role_assignments(id),
  CHECK (replaces_assignment_id IS NULL OR replaces_assignment_id <> id),
  membership_id uuid NOT NULL REFERENCES organization_memberships(id),
  delegation_id uuid REFERENCES system_role_delegations(id),
  idempotency_key uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_type varchar(24) NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by_identity_id uuid NOT NULL REFERENCES identity_references(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_identity_id uuid REFERENCES identity_references(id),
  revoked_at timestamptz,
  FOREIGN KEY (role_id, scope_type) REFERENCES system_role_scopes(role_id, scope_type),
  UNIQUE (id, scope_type),
  CHECK (expires_at IS NULL OR expires_at > valid_from),
  CHECK (version > 0),
  CHECK ((status = 'active' AND revoked_at IS NULL AND revoked_by_identity_id IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_identity_id IS NOT NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (created_by_identity_id, idempotency_key)
)`);
    await queryRunner.query(`CREATE TABLE system_role_delegation_targets (
  delegation_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  scope_type varchar(24) NOT NULL DEFAULT 'organizations',
  PRIMARY KEY (delegation_id, organization_id),
  CHECK (scope_type = 'organizations'),
  FOREIGN KEY (delegation_id, scope_type) REFERENCES system_role_delegations(id, scope_type)
)`);
    await queryRunner.query(`CREATE TABLE system_role_assignment_targets (
  assignment_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  scope_type varchar(24) NOT NULL DEFAULT 'organizations',
  PRIMARY KEY (assignment_id, organization_id),
  CHECK (scope_type = 'organizations'),
  FOREIGN KEY (assignment_id, scope_type) REFERENCES system_role_assignments(id, scope_type)
)`);
    await queryRunner.query(
      `CREATE INDEX ix_system_assignments_membership_status ON system_role_assignments(membership_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_system_assignments_delegation ON system_role_assignments(delegation_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_system_assignments_role_status ON system_role_assignments(role_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_system_delegations_grantee_status ON system_role_delegations(grantee_membership_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_system_delegations_recipient ON system_role_delegations(recipient_organization_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_system_assignment_targets_org ON system_role_assignment_targets(organization_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_system_delegation_targets_org ON system_role_delegation_targets(organization_id)`,
    );
    // The creation transaction owns the open parent. A deferred constraint closes
    // it before commit; another transaction can only observe a closed parent.
    await queryRunner.query(`CREATE FUNCTION preserve_system_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Authorization history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.sealed OR NEW.status <> 'active' OR
       (to_jsonb(NEW) ? 'version' AND (to_jsonb(NEW)->>'version')::integer <> 1) THEN
      RAISE EXCEPTION 'Create an open active record at version 1' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT OLD.sealed AND NEW.sealed AND
     (to_jsonb(NEW) - 'sealed') = (to_jsonb(OLD) - 'sealed') THEN
    RETURN NEW;
  END IF;
  IF NOT OLD.sealed OR NOT NEW.sealed THEN
    RAISE EXCEPTION 'Authorization records cannot be reopened or edited during creation' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'system_roles' THEN
    IF OLD.status = 'active' AND NEW.status = 'disabled' AND
       (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN RETURN NEW; END IF;
  ELSE
    IF OLD.status = 'active' AND NEW.status = 'revoked' AND
       NEW.version = OLD.version + 1 AND NEW.revoked_at IS NOT NULL AND
       NEW.revoked_by_identity_id IS NOT NULL AND
       (to_jsonb(NEW) - ARRAY['status','version','revoked_at','revoked_by_identity_id']) =
       (to_jsonb(OLD) - ARRAY['status','version','revoked_at','revoked_by_identity_id']) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Revoke and replace; authorization history is immutable' USING ERRCODE = '23514';
END $$`);
    await queryRunner.query(`CREATE FUNCTION append_system_history_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_sealed boolean; parent_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Authorization children cannot be edited or deleted' USING ERRCODE = '23514';
  END IF;
  parent_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  EXECUTE format('SELECT sealed FROM %I WHERE id = $1 FOR SHARE', TG_ARGV[0]) INTO parent_sealed USING parent_id;
  IF parent_sealed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Children must be inserted in the parent creation transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$`);
    await queryRunner.query(`CREATE FUNCTION seal_system_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE has_children boolean;
BEGIN
  IF TG_TABLE_NAME = 'system_roles' OR to_jsonb(NEW)->>'scope_type' = 'organizations' THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', TG_ARGV[0], TG_ARGV[1]) INTO has_children USING NEW.id;
    IF NOT has_children THEN
      RAISE EXCEPTION 'Role scopes and organizations targets cannot be empty' USING ERRCODE = '23514';
    END IF;
  END IF;
  EXECUTE format('UPDATE %I SET sealed = true WHERE id = $1 AND NOT sealed', TG_TABLE_NAME) USING NEW.id;
  RETURN NULL;
END $$`);
    await queryRunner.query(`CREATE FUNCTION validate_system_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; previous_id uuid; old_product uuid; new_product uuid;
BEGIN
  previous_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF previous_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT to_jsonb(p) FROM %I p WHERE id = $1 FOR UPDATE', TG_TABLE_NAME) INTO previous USING previous_id;
  IF previous IS NULL OR previous->>'status' <> 'revoked' OR
     previous->>TG_ARGV[1] IS DISTINCT FROM to_jsonb(NEW)->>TG_ARGV[1] THEN
    RAISE EXCEPTION 'Replacement requires a revoked predecessor for the same recipient' USING ERRCODE = '23514';
  END IF;
  SELECT product_id INTO old_product FROM system_roles WHERE id = (previous->>'role_id')::uuid;
  SELECT product_id INTO new_product FROM system_roles WHERE id = NEW.role_id;
  IF old_product IS DISTINCT FROM new_product THEN
    RAISE EXCEPTION 'Replacement must belong to the same product' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$`);
    for (const [parent, child, foreignKey] of [
      ['system_roles', 'system_role_scopes', 'role_id'],
      [
        'system_role_assignments',
        'system_role_assignment_targets',
        'assignment_id',
      ],
      [
        'system_role_delegations',
        'system_role_delegation_targets',
        'delegation_id',
      ],
    ]) {
      await queryRunner.query(
        `CREATE TRIGGER ${parent}_history BEFORE INSERT OR UPDATE OR DELETE ON ${parent} FOR EACH ROW EXECUTE FUNCTION preserve_system_history()`,
      );
      await queryRunner.query(
        `CREATE TRIGGER ${parent}_no_truncate BEFORE TRUNCATE ON ${parent} FOR EACH STATEMENT EXECUTE FUNCTION preserve_system_history()`,
      );
      await queryRunner.query(
        `CREATE CONSTRAINT TRIGGER ${parent}_seal AFTER INSERT ON ${parent} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION seal_system_history('${child}', '${foreignKey}')`,
      );
      await queryRunner.query(
        `CREATE TRIGGER ${child}_history BEFORE INSERT OR UPDATE OR DELETE ON ${child} FOR EACH ROW EXECUTE FUNCTION append_system_history_child('${parent}', '${foreignKey}')`,
      );
      await queryRunner.query(
        `CREATE TRIGGER ${child}_no_truncate BEFORE TRUNCATE ON ${child} FOR EACH STATEMENT EXECUTE FUNCTION append_system_history_child('${parent}', '${foreignKey}')`,
      );
    }
    await queryRunner.query(
      `CREATE TRIGGER system_assignments_replacement BEFORE INSERT ON system_role_assignments FOR EACH ROW EXECUTE FUNCTION validate_system_replacement('replaces_assignment_id', 'membership_id')`,
    );
    await queryRunner.query(
      `CREATE TRIGGER system_delegations_replacement BEFORE INSERT ON system_role_delegations FOR EACH ROW EXECUTE FUNCTION validate_system_replacement('replaces_delegation_id', 'grantee_membership_id')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE system_role_assignment_targets');
    await queryRunner.query('DROP TABLE system_role_delegation_targets');
    await queryRunner.query('DROP TABLE system_role_assignments');
    await queryRunner.query('DROP TABLE system_role_delegations');
    await queryRunner.query('DROP TABLE system_role_scopes');
    await queryRunner.query('DROP TABLE system_roles');
    await queryRunner.query('DROP FUNCTION validate_system_replacement()');
    await queryRunner.query('DROP FUNCTION seal_system_history()');
    await queryRunner.query('DROP FUNCTION append_system_history_child()');
    await queryRunner.query('DROP FUNCTION preserve_system_history()');
  }
}
