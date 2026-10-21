import { listCategories } from "@troba/core";
import type { Metadata } from "next";
import { db } from "@/server/db";
import { requireMoneyUser } from "@/server/money";
import { CreateCategoryForm, DeleteCategory, RenameCategoryForm } from "./category-forms";

export const metadata: Metadata = { title: "Categories · troba" };

export default async function CategoriesPage() {
  const { userId } = await requireMoneyUser();
  const categories = await listCategories(db(), userId);

  return (
    <main>
      <h1>Categories</h1>

      <section aria-labelledby="your-categories">
        <h2 id="your-categories">Your categories</h2>
        {categories.length === 0 ? (
          <p>No categories. Add one below.</p>
        ) : (
          <ul>
            {categories.map((category) => (
              <li key={category.id}>
                <RenameCategoryForm categoryId={category.id} name={category.name} />
                {category.excludedFromSpending ? (
                  // Core refuses the delete too; hiding the button only spares a dead control.
                  <p>
                    Not counted as spending: moving money between your own accounts. It can&apos;t
                    be deleted, since imports put those moves here.
                  </p>
                ) : (
                  <DeleteCategory categoryId={category.id} name={category.name} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-category">
        <h2 id="new-category">New category</h2>
        <CreateCategoryForm />
      </section>
    </main>
  );
}
