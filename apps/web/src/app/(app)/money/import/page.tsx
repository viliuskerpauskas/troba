import {
  aiCategorizationEnabledFor,
  dateFormats,
  listImportProfiles,
  maxImportFileBytes,
} from "@troba/core";
import type { Metadata } from "next";
import { Page } from "@/components/page";
import { db } from "@/server/db";
import { aiCategorizationEnabled, aiMappingEnabled } from "@/server/env";
import { requireMoneyUser } from "@/server/money";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import · troba" };

export default async function ImportPage() {
  const { userId } = await requireMoneyUser();
  const [profiles, optedIn] = await Promise.all([
    listImportProfiles(db(), userId),
    aiCategorizationEnabledFor(db(), userId),
  ]);

  return (
    <Page>
      <h1>Import a bank statement</h1>
      <ImportWizard
        profiles={profiles.map(({ id, name }) => ({ id, name }))}
        dateFormats={dateFormats}
        maxBytes={maxImportFileBytes}
        aiEnabled={aiMappingEnabled()}
        // A key and the user's own switch: either off and the upload step says nothing about it.
        categorizeEnabled={aiCategorizationEnabled() && optedIn}
      />
    </Page>
  );
}
