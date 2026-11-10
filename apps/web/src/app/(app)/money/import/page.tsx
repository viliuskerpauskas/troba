import {
  aiCategorizationEnabledFor,
  dateFormats,
  latestPdfImport,
  maxImportFileBytes,
} from "@troba/core";
import type { Metadata } from "next";
import { Page } from "@/components/page";
import { db } from "@/server/db";
import { aiCategorizationEnabled, aiMappingEnabled, pdfImportEnabled } from "@/server/env";
import { requireMoneyUser } from "@/server/money";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import · troba" };

export default async function ImportPage() {
  const { userId } = await requireMoneyUser();
  const optedIn = await aiCategorizationEnabledFor(db(), userId);
  // A PDF statement the user sent earlier is picked up again, reading or read; the wizard asks
  // where it stands at once.
  const pdfImport = pdfImportEnabled() ? await latestPdfImport(db(), userId) : null;

  return (
    <Page>
      <h1>Import a bank statement</h1>
      <ImportWizard
        dateFormats={dateFormats}
        maxBytes={maxImportFileBytes}
        aiEnabled={aiMappingEnabled()}
        // A key and the user's own switch: either off and the upload step says nothing about it.
        categorizeEnabled={aiCategorizationEnabled() && optedIn}
        pdfEnabled={pdfImportEnabled()}
        resumed={
          pdfImport
            ? { step: "pdf-reading", pdfImportId: pdfImport.id, filename: pdfImport.filename }
            : undefined
        }
      />
    </Page>
  );
}
