"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/analytics/owner";
import { createPlacement, retirePlacement } from "@/lib/analytics/placements";

// Действие зовётся по своему адресу мимо страницы, поэтому владелец
// проверяется здесь заново, а не только в раскладке.
async function owner() {
  if (!(await isOwner())) notFound();
}

export async function addPlacement(form: FormData): Promise<void> {
  await owner();
  await createPlacement({
    name: String(form.get("name") ?? ""),
    channel: String(form.get("channel") ?? ""),
    cost: Number(String(form.get("cost") ?? "0").replace(",", ".") || 0),
  });
  revalidatePath("/admin");
}

export async function retire(form: FormData): Promise<void> {
  await owner();
  await retirePlacement(String(form.get("code") ?? ""));
  revalidatePath("/admin");
}
