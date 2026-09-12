CREATE TYPE "public"."listing_status" AS ENUM('open', 'sold', 'cancelled');--> statement-breakpoint
CREATE TABLE "shop_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"request_key" text NOT NULL,
	"status" "listing_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shop_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"transfer_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_seller_id_characters_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_item_id_item_instances_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sales" ADD CONSTRAINT "shop_sales_listing_id_shop_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."shop_listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sales" ADD CONSTRAINT "shop_sales_buyer_id_characters_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sales" ADD CONSTRAINT "shop_sales_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_listings_seller_request_key" ON "shop_listings" USING btree ("seller_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_listings_open_item_key" ON "shop_listings" USING btree ("item_id") WHERE "shop_listings"."status" = 'open';--> statement-breakpoint
CREATE INDEX "shop_listings_property_idx" ON "shop_listings" USING btree ("property_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_sales_listing_key" ON "shop_sales" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_sales_buyer_request_key" ON "shop_sales" USING btree ("buyer_id","request_key");