CREATE TYPE "public"."house_access" AS ENUM('nobody', 'welcomed', 'everyone');--> statement-breakpoint
CREATE TABLE "house_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"access" "house_access" DEFAULT 'welcomed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "house_guests" ADD CONSTRAINT "house_guests_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_guests" ADD CONSTRAINT "house_guests_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "houses" ADD CONSTRAINT "houses_owner_id_characters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "house_guests_pair_key" ON "house_guests" USING btree ("house_id","character_id");--> statement-breakpoint
CREATE INDEX "house_guests_house_idx" ON "house_guests" USING btree ("house_id");--> statement-breakpoint
CREATE UNIQUE INDEX "houses_owner_key" ON "houses" USING btree ("owner_id");