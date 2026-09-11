CREATE TYPE "public"."account_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."facing_direction" AS ENUM('n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalised" text NOT NULL,
	"password_hash" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"is_moderator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalised" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"facing" "facing_direction" DEFAULT 's' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_normalised_key" ON "accounts" USING btree ("email_normalised");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_name_normalised_key" ON "characters" USING btree ("name_normalised");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_account_id_key" ON "characters" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "characters_last_seen_at_idx" ON "characters" USING btree ("last_seen_at");