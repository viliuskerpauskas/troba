CREATE TABLE "money_ai_categorize_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"import_id" uuid,
	"finished_at" timestamp with time zone,
	"merchants_asked" integer DEFAULT 0 NOT NULL,
	"rows_suggested" integer DEFAULT 0 NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"capped" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_ai_categorize_runs_import_id_unique" UNIQUE("import_id")
);
--> statement-breakpoint
ALTER TABLE "money_ai_categorize_runs" ADD CONSTRAINT "money_ai_categorize_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_ai_categorize_runs" ADD CONSTRAINT "money_ai_categorize_runs_import_id_money_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."money_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_ai_categorize_runs_user_id_created_at_idx" ON "money_ai_categorize_runs" USING btree ("user_id","created_at");