import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccessEventBusInbox1785727031000 implements MigrationInterface {
  name = 'AddAccessEventBusInbox1785727031000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "access_event_inbox" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_id" character varying(160) NOT NULL,
        "event_type" character varying(160) NOT NULL,
        "correlation_id" character varying(160),
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_access_event_inbox" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_access_event_inbox_event_id" ON "access_event_inbox" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_access_event_inbox_event_type" ON "access_event_inbox" ("event_type", "received_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_access_outbox_status_attempt" ON "outbox_events" ("status", "next_attempt_at", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."ix_access_outbox_status_attempt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ix_access_event_inbox_event_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ux_access_event_inbox_event_id"`,
    );
    await queryRunner.query(`DROP TABLE "access_event_inbox"`);
  }
}
