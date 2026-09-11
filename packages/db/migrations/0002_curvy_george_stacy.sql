CREATE TYPE "public"."item_holder" AS ENUM('character', 'house', 'escrow');--> statement-breakpoint
CREATE TABLE "item_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" text NOT NULL,
	"holder_kind" "item_holder" NOT NULL,
	"holder_id" uuid NOT NULL,
	"x" integer,
	"y" integer,
	"rotation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"from_account" text NOT NULL,
	"to_account" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_definition_id_item_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."item_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_instances_holder_idx" ON "item_instances" USING btree ("holder_kind","holder_id");--> statement-breakpoint
CREATE INDEX "item_instances_definition_idx" ON "item_instances" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ledger_entries_transfer_idx" ON "ledger_entries" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_idempotency_key" ON "transfers" USING btree ("idempotency_key");