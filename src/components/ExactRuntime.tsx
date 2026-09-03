"use client";
import { useEffect } from "react";

/** Loads the original theme's scripts in the order the live site loaded them,
 *  then lets UIkit scan the markup so every slider, reveal and lightbox works. */
export function ExactRuntime({ branch, bodyClass }: { branch: string; bodyClass: string }) {
  useEffect(() => {
    const prev = document.body.className;
    document.body.className = bodyClass;

    const base = `/media/${branch}/wp-content/themes/yootheme`;
    const srcs = [
      `/media/${branch}/wp-includes/js/jquery/jquery.min.js`,
      `/media/${branch}/wp-includes/js/jquery/jquery-migrate.min.js`,
      // UIkit first: the cookie banner script calls UIkit at parse time, and on
      // the live site it only ever runs after UIkit is on the page
      `${base}/vendor/assets/uikit/dist/js/uikit.min.js`,
      `${base}/vendor/assets/uikit/dist/js/uikit-icons-kojiro.min.js`,
      `${base}/packages/theme-cookie/app/cookie.min.js`,
      `${base}/js/theme.js`,
    ];

    let cancelled = false;
    const added: HTMLScriptElement[] = [];

    const load = (src: string) =>
      new Promise<void>((resolve) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-exact="${src}"]`);
        if (existing) return resolve();
        const el = document.createElement("script");
        el.src = src;
        el.async = false;
        el.dataset.exact = src;
        el.onload = () => resolve();
        el.onerror = () => resolve();
        document.body.appendChild(el);
        added.push(el);
      });

    (async () => {
      for (const s of srcs) {
        if (cancelled) return;
        await load(s);
      }
      // UIkit initialises on DOMContentLoaded, which has already fired
      const uk = (window as unknown as { UIkit?: { update?: (el?: Element) => void } }).UIkit;
      uk?.update?.(document.body);
    })();

    return () => {
      cancelled = true;
      document.body.className = prev;
      added.forEach((el) => el.remove());
    };
  }, [branch, bodyClass]);

  return null;
}
