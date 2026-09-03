import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExactRuntime } from "@/components/ExactRuntime";

type Entry = { slug: string; file: string; title: string; description: string; bodyClass: string; branch: string };

const dir = path.join(process.cwd(), "src/exact");
const pages: Entry[] = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));

function find(slug: string[] | undefined): Entry | undefined {
  const key = (slug ?? []).join("/");
  return pages.find((p) => p.slug === key);
}

export function generateStaticParams() {
  return pages.map((p) => ({ slug: p.slug === "" ? [] : p.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const entry = find((await params).slug);
  if (!entry) return {};
  return { title: entry.title.replace(/\s*\|\s*Varanasi$/, "") || "Varanasi", description: entry.description || undefined };
}

export default async function ExactPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const entry = find((await params).slug);
  if (!entry) notFound();

  const html = fs.readFileSync(path.join(dir, "pages", entry.file), "utf8");
  const themeCss = entry.branch === "leicester"
    ? "/media/leicester/wp-content/themes/yootheme/css/theme.5.css"
    : "/media/birmingham/wp-content/themes/yootheme/css/theme.3.css";

  return (
    <>
      <link rel="stylesheet" href={`/media/${entry.branch}/wp-includes/css/dist/block-library/style.min.css`} />
      <link rel="stylesheet" href={themeCss} />
      <ExactRuntime branch={entry.branch} bodyClass={entry.bodyClass} />
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
