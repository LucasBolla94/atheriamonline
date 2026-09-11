CREATE TYPE "public"."trade_status" AS ENUM('open', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "trade_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"offered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiator_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" "trade_status" DEFAULT 'open' NOT NULL,
	"initiator_confirmed" boolean DEFAULT false NOT NULL,
	"partner_confirmed" boolean DEFAULT false NOT NULL,
	"initiator_money" bigint DEFAULT 0 NOT NULL,
	"partner_money" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_item_id_item_instances_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_offered_by_characters_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_id_characters_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_partner_id_characters_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_items_item_key" ON "trade_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "trade_items_trade_idx" ON "trade_items" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "trades_initiator_idx" ON "trades" USING btree ("initiator_id","status");--> statement-breakpoint
CREATE INDEX "trades_partner_idx" ON "trades" USING btree ("partner_id","status");