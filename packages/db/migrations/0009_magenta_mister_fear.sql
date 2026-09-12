CREATE TABLE "lounge_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"requested_start" timestamp with time zone,
	"request_key" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lounge_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"character_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lounge_bookings" ADD CONSTRAINT "lounge_bookings_host_id_characters_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lounge_invitations" ADD CONSTRAINT "lounge_invitations_booking_id_lounge_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."lounge_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lounge_invitations" ADD CONSTRAINT "lounge_invitations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lounge_bookings_host_request_key" ON "lounge_bookings" USING btree ("host_id","request_key");--> statement-breakpoint
CREATE INDEX "lounge_bookings_room_time_idx" ON "lounge_bookings" USING btree ("room_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lounge_invitations_pair_key" ON "lounge_invitations" USING btree ("booking_id","character_id");