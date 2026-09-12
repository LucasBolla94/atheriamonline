CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" text NOT NULL,
	"building_id" text NOT NULL,
	"municipal" boolean NOT NULL,
	"owner_id" uuid,
	"price" bigint NOT NULL,
	"business_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"access" "house_access" DEFAULT 'nobody' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"floor_style" text DEFAULT 'oak' NOT NULL,
	"wall_style" text DEFAULT 'cream' NOT NULL,
	"purchased_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"transfer_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_id_characters_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_purchases" ADD CONSTRAINT "property_purchases_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_purchases" ADD CONSTRAINT "property_purchases_buyer_id_characters_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_purchases" ADD CONSTRAINT "property_purchases_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_address_key" ON "properties" USING btree ("city_id","building_id");--> statement-breakpoint
CREATE INDEX "properties_owner_idx" ON "properties" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_purchases_request_key" ON "property_purchases" USING btree ("buyer_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "property_purchases_property_key" ON "property_purchases" USING btree ("property_id");