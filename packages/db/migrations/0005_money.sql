CREATE TABLE "money_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"iban" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_accounts_type_check" CHECK ("money_accounts"."type" in ('bank', 'cash', 'other')),
	CONSTRAINT "money_accounts_currency_check" CHECK ("money_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "money_accounts_iban_check" CHECK ("money_accounts"."iban" is null or "money_accounts"."type" = 'bank')
);
--> statement-breakpoint
CREATE TABLE "money_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_attachments_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "money_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"excluded_from_spending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"header_fingerprint" text NOT NULL,
	"skip_lines" integer DEFAULT 0 NOT NULL,
	"delimiter" text,
	"encoding" text DEFAULT 'utf-8' NOT NULL,
	"decimal_separator" text NOT NULL,
	"date_format" text NOT NULL,
	"columns" jsonb NOT NULL,
	"debit_values" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" uuid,
	"filename" text NOT NULL,
	"rows_parsed" integer NOT NULL,
	"rows_new" integer NOT NULL,
	"rows_duplicate" integer NOT NULL,
	"rows_failed" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"field" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_rules_field_check" CHECK ("money_rules"."field" in ('counterparty', 'description'))
);
--> statement-breakpoint
CREATE TABLE "money_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"defaults_seeded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"booked_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"original_amount_cents" bigint,
	"original_currency" char(3),
	"counterparty" text,
	"counterparty_iban" text,
	"description" text,
	"bank_tx_type" text,
	"category_id" uuid,
	"category_source" text,
	"note" text,
	"source" text NOT NULL,
	"import_id" uuid,
	"dedup_key" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_transactions_currency_check" CHECK ("money_transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "money_transactions_original_check" CHECK (("money_transactions"."original_amount_cents" is null) = ("money_transactions"."original_currency" is null)),
	CONSTRAINT "money_transactions_category_source_check" CHECK ("money_transactions"."category_source" is null or "money_transactions"."category_source" in ('manual', 'rule', 'transfer')),
	CONSTRAINT "money_transactions_source_check" CHECK ("money_transactions"."source" in ('manual', 'csv_import'))
);
--> statement-breakpoint
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_attachments" ADD CONSTRAINT "money_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_attachments" ADD CONSTRAINT "money_attachments_transaction_id_money_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."money_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_categories" ADD CONSTRAINT "money_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_import_profiles" ADD CONSTRAINT "money_import_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_imports" ADD CONSTRAINT "money_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_imports" ADD CONSTRAINT "money_imports_account_id_money_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_imports" ADD CONSTRAINT "money_imports_profile_id_money_import_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."money_import_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_rules" ADD CONSTRAINT "money_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_rules" ADD CONSTRAINT "money_rules_category_id_money_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."money_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_settings" ADD CONSTRAINT "money_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_account_id_money_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."money_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_category_id_money_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."money_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_import_id_money_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."money_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "money_accounts_user_id_iban_idx" ON "money_accounts" USING btree ("user_id","iban");--> statement-breakpoint
CREATE INDEX "money_attachments_user_id_idx" ON "money_attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "money_attachments_transaction_id_idx" ON "money_attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "money_categories_user_id_idx" ON "money_categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "money_import_profiles_user_id_fingerprint_idx" ON "money_import_profiles" USING btree ("user_id","header_fingerprint");--> statement-breakpoint
CREATE INDEX "money_imports_user_id_imported_at_idx" ON "money_imports" USING btree ("user_id","imported_at");--> statement-breakpoint
CREATE INDEX "money_imports_profile_id_idx" ON "money_imports" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "money_rules_user_id_position_idx" ON "money_rules" USING btree ("user_id","position");--> statement-breakpoint
CREATE INDEX "money_rules_category_id_idx" ON "money_rules" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "money_transactions_user_id_account_id_dedup_key_idx" ON "money_transactions" USING btree ("user_id","account_id","dedup_key");--> statement-breakpoint
CREATE INDEX "money_transactions_user_id_booked_on_idx" ON "money_transactions" USING btree ("user_id","booked_on");--> statement-breakpoint
CREATE INDEX "money_transactions_account_id_idx" ON "money_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "money_transactions_category_id_idx" ON "money_transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "money_transactions_import_id_idx" ON "money_transactions" USING btree ("import_id");