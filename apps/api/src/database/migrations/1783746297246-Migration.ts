import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1783746297246 implements MigrationInterface {
    name = 'Migration1783746297246'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "actor_type" character varying NOT NULL, "actor_issuer" character varying, "actor_subject_id" character varying, "action" character varying NOT NULL, "resource_type" character varying NOT NULL, "resource_id" character varying NOT NULL, "before_snapshot" jsonb, "after_snapshot" jsonb, "ip_address" character varying, "user_agent" character varying, "correlation_id" character varying, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "metadata" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_910f64d901a5c3e9878f0d4a407" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "identity_references" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "issuer" character varying NOT NULL, "subject_id" character varying NOT NULL, "identity_type" character varying NOT NULL, "email_snapshot" character varying, "display_name_snapshot" character varying, "avatar_url_snapshot" character varying, "status" character varying NOT NULL DEFAULT 'active', "last_synced_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8046da8fc70e97fd4f2dd3596a2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_identity_references_issuer_subject" ON "identity_references"  ("issuer", "subject_id") `);
        await queryRunner.query(`CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "slug" character varying NOT NULL, "name" character varying NOT NULL, "legal_name" character varying, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "country_code" character varying, "timezone" character varying, "metadata" jsonb NOT NULL DEFAULT '{}', "version" integer NOT NULL DEFAULT '1', "created_by_identity_id" uuid NOT NULL, "updated_by_identity_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_organizations_slug_active" ON "organizations"  ("slug") WHERE "archived_at" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_organizations_code" ON "organizations"  ("code") `);
        await queryRunner.query(`CREATE TABLE "organization_invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "email_normalized" character varying NOT NULL, "identity_issuer_hint" character varying, "product_code" character varying, "role_codes" jsonb NOT NULL DEFAULT '[]', "token_hash" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "accepted_by_identity_id" uuid, "accepted_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_by_identity_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f172f12b8a9ee6584b661f57e24" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_invitations_token_hash" ON "organization_invitations"  ("token_hash") `);
        await queryRunner.query(`CREATE INDEX "ix_invitations_org_status" ON "organization_invitations"  ("organization_id", "status") `);
        await queryRunner.query(`CREATE TABLE "organization_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "identity_reference_id" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "membership_type" character varying NOT NULL DEFAULT 'member', "joined_at" TIMESTAMP WITH TIME ZONE, "suspended_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "metadata" jsonb NOT NULL DEFAULT '{}', "version" integer NOT NULL DEFAULT '1', "context_version" integer NOT NULL DEFAULT '1', "created_by_identity_id" uuid NOT NULL, "updated_by_identity_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cd7be805730a4c778a5f45364af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_memberships_org_status" ON "organization_memberships"  ("organization_id", "status") `);
        await queryRunner.query(`CREATE INDEX "ix_memberships_identity_status" ON "organization_memberships"  ("identity_reference_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_membership_org_identity" ON "organization_memberships"  ("organization_id", "identity_reference_id") `);
        await queryRunner.query(`CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_type" character varying NOT NULL, "aggregate_type" character varying NOT NULL, "aggregate_id" character varying NOT NULL, "payload" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "last_error" text, CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "audience" character varying NOT NULL DEFAULT 'internal', "provisioning_mode" character varying NOT NULL DEFAULT 'none', "status" character varying NOT NULL DEFAULT 'active', "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_products_code" ON "products"  ("code") `);
        await queryRunner.query(`CREATE TABLE "organization_products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "product_id" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "source" character varying NOT NULL DEFAULT 'manual', "entitlement_reference" character varying, "configuration" jsonb NOT NULL DEFAULT '{}', "enabled_at" TIMESTAMP WITH TIME ZONE, "suspended_at" TIMESTAMP WITH TIME ZONE, "disabled_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL DEFAULT '1', "created_by_identity_id" uuid NOT NULL, "updated_by_identity_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4bc57c33ff4d7182e46e3bf590c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_org_products_status" ON "organization_products"  ("organization_id", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_org_products" ON "organization_products"  ("organization_id", "product_id") `);
        await queryRunner.query(`CREATE TABLE "organization_product_instances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_product_id" uuid NOT NULL, "external_tenant_id" character varying, "status" character varying NOT NULL, "provisioned_at" TIMESTAMP WITH TIME ZONE, "last_verified_at" TIMESTAMP WITH TIME ZONE, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_df7520de926581f2c5d7755d292" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_product_instances_org_product" ON "organization_product_instances"  ("organization_product_id") `);
        await queryRunner.query(`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "code" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "scope" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'active', "is_system" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_roles_org_code" ON "roles"  ("organization_id", "code") WHERE "organization_id" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_roles_global_code" ON "roles"  ("code") WHERE "organization_id" IS NULL`);
        await queryRunner.query(`CREATE TABLE "membership_roles" ("membership_id" uuid NOT NULL, "role_id" uuid NOT NULL, "assigned_by_identity_id" uuid NOT NULL, "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_9f66b1234388294e15f26799afe" PRIMARY KEY ("membership_id", "role_id"))`);
        await queryRunner.query(`CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "scope" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ux_permissions_code" ON "permissions"  ("code") `);
        await queryRunner.query(`CREATE TABLE "role_permissions" ("role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id"))`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD CONSTRAINT "FK_8e6b7f14d8c003f32389077fc3d" FOREIGN KEY ("created_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organizations" ADD CONSTRAINT "FK_5465cb11c50263d5e16b429775e" FOREIGN KEY ("updated_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_7f88954e8d667a76ae3ced6f446" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_c23e89f415092213a07ac5fe130" FOREIGN KEY ("accepted_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" ADD CONSTRAINT "FK_ca998535cfa3ea2582abdac231f" FOREIGN KEY ("created_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_memberships" ADD CONSTRAINT "FK_86ae2efbb9ce84dd652e0c96a49" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_memberships" ADD CONSTRAINT "FK_6469c90678133e0dc91dd40b182" FOREIGN KEY ("identity_reference_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_products" ADD CONSTRAINT "FK_fafca24b20489b6935f715adbf9" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_products" ADD CONSTRAINT "FK_b803c494e006103983f49845161" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_products" ADD CONSTRAINT "FK_bc46a5b7b4333d6496d2373da9c" FOREIGN KEY ("created_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_products" ADD CONSTRAINT "FK_97d8e86a15ef1ded130c559ef79" FOREIGN KEY ("updated_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization_product_instances" ADD CONSTRAINT "FK_5b475054705ea3df21ed07a6e70" FOREIGN KEY ("organization_product_id") REFERENCES "organization_products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "roles" ADD CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_roles" ADD CONSTRAINT "FK_cee7bc65abd4c38c856f1361fd6" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_roles" ADD CONSTRAINT "FK_c625b47ba8734dafec257d918f7" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "membership_roles" ADD CONSTRAINT "FK_1eb3f048b2e9a5ca271373968dd" FOREIGN KEY ("assigned_by_identity_id") REFERENCES "identity_references"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`);
        await queryRunner.query(`ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`);
        await queryRunner.query(`ALTER TABLE "membership_roles" DROP CONSTRAINT "FK_1eb3f048b2e9a5ca271373968dd"`);
        await queryRunner.query(`ALTER TABLE "membership_roles" DROP CONSTRAINT "FK_c625b47ba8734dafec257d918f7"`);
        await queryRunner.query(`ALTER TABLE "membership_roles" DROP CONSTRAINT "FK_cee7bc65abd4c38c856f1361fd6"`);
        await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT "FK_c328a1ecd12a5f153a96df4509e"`);
        await queryRunner.query(`ALTER TABLE "organization_product_instances" DROP CONSTRAINT "FK_5b475054705ea3df21ed07a6e70"`);
        await queryRunner.query(`ALTER TABLE "organization_products" DROP CONSTRAINT "FK_97d8e86a15ef1ded130c559ef79"`);
        await queryRunner.query(`ALTER TABLE "organization_products" DROP CONSTRAINT "FK_bc46a5b7b4333d6496d2373da9c"`);
        await queryRunner.query(`ALTER TABLE "organization_products" DROP CONSTRAINT "FK_b803c494e006103983f49845161"`);
        await queryRunner.query(`ALTER TABLE "organization_products" DROP CONSTRAINT "FK_fafca24b20489b6935f715adbf9"`);
        await queryRunner.query(`ALTER TABLE "organization_memberships" DROP CONSTRAINT "FK_6469c90678133e0dc91dd40b182"`);
        await queryRunner.query(`ALTER TABLE "organization_memberships" DROP CONSTRAINT "FK_86ae2efbb9ce84dd652e0c96a49"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_ca998535cfa3ea2582abdac231f"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_c23e89f415092213a07ac5fe130"`);
        await queryRunner.query(`ALTER TABLE "organization_invitations" DROP CONSTRAINT "FK_7f88954e8d667a76ae3ced6f446"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT "FK_5465cb11c50263d5e16b429775e"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP CONSTRAINT "FK_8e6b7f14d8c003f32389077fc3d"`);
        await queryRunner.query(`DROP TABLE "role_permissions"`);
        await queryRunner.query(`DROP INDEX "public"."ux_permissions_code"`);
        await queryRunner.query(`DROP TABLE "permissions"`);
        await queryRunner.query(`DROP TABLE "membership_roles"`);
        await queryRunner.query(`DROP INDEX "public"."ux_roles_global_code"`);
        await queryRunner.query(`DROP INDEX "public"."ux_roles_org_code"`);
        await queryRunner.query(`DROP TABLE "roles"`);
        await queryRunner.query(`DROP INDEX "public"."ux_product_instances_org_product"`);
        await queryRunner.query(`DROP TABLE "organization_product_instances"`);
        await queryRunner.query(`DROP INDEX "public"."ux_org_products"`);
        await queryRunner.query(`DROP INDEX "public"."ix_org_products_status"`);
        await queryRunner.query(`DROP TABLE "organization_products"`);
        await queryRunner.query(`DROP INDEX "public"."ux_products_code"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "outbox_events"`);
        await queryRunner.query(`DROP INDEX "public"."ux_membership_org_identity"`);
        await queryRunner.query(`DROP INDEX "public"."ix_memberships_identity_status"`);
        await queryRunner.query(`DROP INDEX "public"."ix_memberships_org_status"`);
        await queryRunner.query(`DROP TABLE "organization_memberships"`);
        await queryRunner.query(`DROP INDEX "public"."ix_invitations_org_status"`);
        await queryRunner.query(`DROP INDEX "public"."ux_invitations_token_hash"`);
        await queryRunner.query(`DROP TABLE "organization_invitations"`);
        await queryRunner.query(`DROP INDEX "public"."ux_organizations_code"`);
        await queryRunner.query(`DROP INDEX "public"."ux_organizations_slug_active"`);
        await queryRunner.query(`DROP TABLE "organizations"`);
        await queryRunner.query(`DROP INDEX "public"."ux_identity_references_issuer_subject"`);
        await queryRunner.query(`DROP TABLE "identity_references"`);
        await queryRunner.query(`DROP TABLE "audit_events"`);
    }

}
