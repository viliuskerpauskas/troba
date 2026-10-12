CREATE TABLE "sign_in_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sign_in_attempts_email_idx" ON "sign_in_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_attempts_ip_address_idx" ON "sign_in_attempts" USING btree ("ip_address","created_at");