CREATE TABLE "money_ai_pdf_import_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pdf_import_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_ai_pdf_import_uses_pdf_import_id_unique" UNIQUE("pdf_import_id")
);
--> statement-breakpoint
ALTER TABLE "money_ai_pdf_import_uses" ADD CONSTRAINT "money_ai_pdf_import_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_ai_pdf_import_uses_user_id_created_at_idx" ON "money_ai_pdf_import_uses" USING btree ("user_id","created_at");