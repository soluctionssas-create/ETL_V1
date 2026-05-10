"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function normalizeTodoName(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 200);
}

export async function addTodo(formData: FormData) {
  const name = normalizeTodoName(formData.get("name"));
  if (!name) return;

  const supabase = await createClient();
  await supabase.from("todos").insert({ name });

  revalidatePath("/");
}

export async function deleteTodo(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;

  const supabase = await createClient();
  await supabase.from("todos").delete().eq("id", id);

  revalidatePath("/");
}
