import { listCategories } from "@troba/core";
import type { Metadata } from "next";
import { Page } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { CreateCategoryForm, DeleteCategory, RenameCategoryForm } from "./category-forms";

export const metadata: Metadata = { title: "Categories · troba" };

export default async function CategoriesPage() {
  const { userId } = await requireMoneyUser();
  const categories = await listCategories(db(), userId);

  return (
    <Page>
      <h1>Categories</h1>

      <section aria-labelledby="your-categories" className="flex flex-col gap-3">
        <h2 id="your-categories">Your categories</h2>
        {categories.length === 0 ? (
          <p className="text-muted-foreground">No categories. Add one below.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {categories.map((category) => (
              <li key={category.id}>
                <Card size="sm">
                  <CardContent className="flex flex-col gap-3">
                    <RenameCategoryForm categoryId={category.id} name={category.name} />
                    {category.excludedFromSpending ? (
                      // Core refuses the delete too; hiding the button only spares a dead control.
                      <p className="text-muted-foreground">
                        Not counted as spending: moving money between your own accounts. It
                        can&apos;t be deleted, since imports put those moves here.
                      </p>
                    ) : (
                      <DeleteCategory categoryId={category.id} name={category.name} />
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-category" className="flex flex-col gap-3">
        <h2 id="new-category">New category</h2>
        <CreateCategoryForm />
      </section>
    </Page>
  );
}
