CREATE TABLE "money_ai_categorize_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchants" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "money_ai_categorize_uses" ADD CONSTRAINT "money_ai_categorize_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_ai_categorize_uses_user_id_created_at_idx" ON "money_ai_categorize_uses" USING btree ("user_id","created_at");