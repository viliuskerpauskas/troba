CREATE TABLE "money_pdf_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"bytes" "bytea",
	"answer" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_pdf_imports_state_check" CHECK ("money_pdf_imports"."state" in ('queued', 'reading', 'read', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "money_pdf_imports" ADD CONSTRAINT "money_pdf_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_pdf_imports_user_id_created_at_idx" ON "money_pdf_imports" USING btree ("user_id","created_at");