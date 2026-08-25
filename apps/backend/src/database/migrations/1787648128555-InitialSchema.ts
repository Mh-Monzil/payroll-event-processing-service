import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1787648128555 implements MigrationInterface {
  name = 'InitialSchema1787648128555';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // payroll_events.id defaults to uuid_generate_v4(), which lives in this
    // extension. Creating it here rather than by hand keeps a fresh database
    // one `migration:run` away from being usable.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."event_status_history_fromstatus_enum" AS ENUM('PENDING', 'QUEUED', 'PROCESSING', 'AWAITING_RETRY', 'SUCCEEDED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."event_status_history_tostatus_enum" AS ENUM('PENDING', 'QUEUED', 'PROCESSING', 'AWAITING_RETRY', 'SUCCEEDED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "event_status_history" ("id" BIGSERIAL NOT NULL, "eventId" uuid NOT NULL, "fromStatus" "public"."event_status_history_fromstatus_enum", "toStatus" "public"."event_status_history_tostatus_enum" NOT NULL, "attempt" integer NOT NULL DEFAULT '0', "message" text, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_154c37081eece32f4ed56af4eb8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfaf103c68e5b219878c8d7731" ON "event_status_history" ("eventId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payroll_events_status_enum" AS ENUM('PENDING', 'QUEUED', 'PROCESSING', 'AWAITING_RETRY', 'SUCCEEDED', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payroll_events_failurekind_enum" AS ENUM('PERMANENT', 'RETRIES_EXHAUSTED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payroll_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "idempotencyKey" character varying(128) NOT NULL, "sequence" BIGSERIAL NOT NULL, "employeeId" character varying(64) NOT NULL, "type" character varying(64) NOT NULL, "effectiveDate" date NOT NULL, "payload" jsonb NOT NULL, "status" "public"."payroll_events_status_enum" NOT NULL DEFAULT 'PENDING', "attemptCount" integer NOT NULL DEFAULT '0', "failureKind" "public"."payroll_events_failurekind_enum", "lastErrorCode" character varying(64), "lastErrorMessage" text, "lastErrorDetail" jsonb, "result" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "queuedAt" TIMESTAMP WITH TIME ZONE, "processingStartedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "nextRetryAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_939639808d34b032060090ef22c" UNIQUE ("idempotencyKey"), CONSTRAINT "PK_740896ef1e47dcb679157df49f1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2ce729cb2c570059ec039771e" ON "payroll_events" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd9840e989f2e5ff6ca75412f8" ON "payroll_events" ("employeeId", "sequence") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payroll_applications" ("eventId" uuid NOT NULL, "employeeId" character varying(64) NOT NULL, "externalRef" character varying(64), "snapshotBefore" jsonb, "appliedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_eb06fb218cb12b1ce42d41540a5" PRIMARY KEY ("eventId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e216415d0fa689c1e615e5edb" ON "payroll_applications" ("employeeId", "appliedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "employee_payroll_states" ("employeeId" character varying(64) NOT NULL, "iban" character varying(34), "street" character varying(255), "city" character varying(128), "postalCode" character varying(16), "country" character(2), "salaryAmount" numeric(14,2), "salaryCurrency" character(3), "lastAppliedEventId" uuid, "lastEffectiveDate" date, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3750f7ef15075304fa863cbdebb" PRIMARY KEY ("employeeId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "employees" ("id" character varying(64) NOT NULL, "fullName" character varying(128) NOT NULL, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b9535a98350d5b26e7eb0c26af4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_status_history" ADD CONSTRAINT "FK_6a701edf518133152b04d9d09bb" FOREIGN KEY ("eventId") REFERENCES "payroll_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payroll_applications" ADD CONSTRAINT "FK_eb06fb218cb12b1ce42d41540a5" FOREIGN KEY ("eventId") REFERENCES "payroll_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payroll_applications" DROP CONSTRAINT "FK_eb06fb218cb12b1ce42d41540a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_status_history" DROP CONSTRAINT "FK_6a701edf518133152b04d9d09bb"`,
    );
    await queryRunner.query(`DROP TABLE "employees"`);
    await queryRunner.query(`DROP TABLE "employee_payroll_states"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e216415d0fa689c1e615e5edb"`,
    );
    await queryRunner.query(`DROP TABLE "payroll_applications"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd9840e989f2e5ff6ca75412f8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2ce729cb2c570059ec039771e"`,
    );
    await queryRunner.query(`DROP TABLE "payroll_events"`);
    await queryRunner.query(
      `DROP TYPE "public"."payroll_events_failurekind_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payroll_events_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfaf103c68e5b219878c8d7731"`,
    );
    await queryRunner.query(`DROP TABLE "event_status_history"`);
    await queryRunner.query(
      `DROP TYPE "public"."event_status_history_tostatus_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."event_status_history_fromstatus_enum"`,
    );
  }
}
