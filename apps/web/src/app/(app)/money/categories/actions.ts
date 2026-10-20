"use server";

import { createCategory, deleteCategory, renameCategory } from "@troba/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

export type CategoryFormState = { error?: string; message?: string };

const Name = z.string().trim().min(1).max(100);

const CategoryId = z.uuid();

// Transactions show their category's name, so they change with it.
function revalidateCategories() {
  revalidatePath("/money/categories");
  revalidatePath("/money/transactions");
}

export async function createCategoryAction(
  _state: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const { userId } = await requireUser();
  const name = Name.safeParse(formData.get("name"));
  if (!name.success) return { error: "Enter a name of up to 100 characters." };

  const category = await createCategory(db(), userId, { name: name.data });
  revalidateCategories();
  return { message: `Added ${category.name}.` };
}

export async function renameCategoryAction(
  _state: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const { userId } = await requireUser();
  const categoryId = CategoryId.safeParse(formData.get("categoryId"));
  const name = Name.safeParse(formData.get("name"));
  if (!categoryId.success) return { error: "That category doesn't exist." };
  if (!name.success) return { error: "Enter a name of up to 100 characters." };

  if (!(await renameCategory(db(), userId, { categoryId: categoryId.data, name: name.data }))) {
    return { error: "That category doesn't exist." };
  }
  revalidateCategories();
  return { message: "Saved." };
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const categoryId = CategoryId.safeParse(formData.get("categoryId"));
  if (!categoryId.success) return;

  await deleteCategory(db(), userId, { categoryId: categoryId.data });
  revalidateCategories();
}
