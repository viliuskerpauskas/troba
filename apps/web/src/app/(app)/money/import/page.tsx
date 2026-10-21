import { dateFormats, listImportProfiles, maxImportFileBytes } from "@troba/core";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import · troba" };

export default async function ImportPage() {
  const { userId } = await requireMoneyUser();
  const profiles = await listImportProfiles(db(), userId);

  return (
    <main>
      <h1>Import a bank statement</h1>
      <ImportWizard
        profiles={profiles.map(({ id, name }) => ({ id, name }))}
        dateFormats={dateFormats}
        maxBytes={maxImportFileBytes}
      />
    </main>
  );
}
