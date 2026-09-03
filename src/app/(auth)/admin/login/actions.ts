"use server";
import { redirect } from "next/navigation";
import { createSession, verifyLogin } from "@/lib/auth";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const session = await verifyLogin(email, password);
  if (!session) return { error: "Those details don't match an active account." };

  await createSession(session);
  redirect(session.mustChangePassword ? "/admin/password" : "/admin");
}
