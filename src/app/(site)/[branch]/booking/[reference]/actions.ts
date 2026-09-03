"use server";
import { redirect } from "next/navigation";
import { cancelByToken } from "@/lib/booking";

export async function cancelBooking(formData: FormData) {
  const branch = String(formData.get("branch") ?? "");
  const reference = String(formData.get("reference") ?? "");
  const token = String(formData.get("token") ?? "");

  const result = cancelByToken(reference, token);
  const base = `/${branch}/booking/${reference}?t=${encodeURIComponent(token)}`;
  redirect(result.ok ? `${base}&cancelled=1` : `${base}&error=${encodeURIComponent(result.error ?? "That didn't work.")}`);
}
