/**
 * Where every <Image> on the site resolves its URL.
 *
 * The photography lives in Cloudinary rather than in the repository: it is
 * roughly a quarter of a gigabyte, which GitHub complains about and which
 * would otherwise be copied into every deploy. What the database stores is
 * still the original site-relative path — `/media/lib/birmingham/2024/07/x.jpg`
 * — because that is what the admin's own placeholder text tells staff to type,
 * and because a database full of absolute CDN URLs is welded to one vendor.
 * The translation to a CDN happens here, at the last possible moment.
 *
 * Two environment variables control it, and both are read at build time
 * because NEXT_PUBLIC_ values are inlined:
 *
 *   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME  the cloud name, e.g. qu72ymeo.
 *                                      Unset - every image is served locally
 *                                      from public/, exactly as before.
 *   NEXT_PUBLIC_CLOUDINARY_FOLDER      the folder the uploads landed in, if
 *                                      any. Dragging a folder into the media
 *                                      library puts it at the root, so
 *                                      `birmingham/...` is the common case and
 *                                      the default of "" is correct. Set it to
 *                                      `media/lib` if the full path was kept.
 *
 * Getting the folder wrong shows up as broken images and is fixed by editing
 * one variable and redeploying — no touching the seed data, and no migration.
 */

const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";
const FOLDER = (process.env.NEXT_PUBLIC_CLOUDINARY_FOLDER || "").replace(/^\/+|\/+$/g, "");

/** Paths under this are the imported media library; everything else is local. */
const MEDIA_PREFIX = /^\/media\/(?:lib\/)?/;

export default function cloudinaryLoader({ src, width, quality }) {
  // Anything already absolute is somebody's deliberate choice — leave it be.
  if (/^https?:\/\//i.test(src)) return src;

  // Brand marks, icons and the handful of files committed to public/ are small
  // and already optimised. Serving them straight from the app keeps the site
  // working with no CDN configured at all.
  if (!CLOUD || !MEDIA_PREFIX.test(src)) return src;

  const id = src.replace(MEDIA_PREFIX, "").replace(/^\/+/, "");
  const publicId = FOLDER ? `${FOLDER}/${id}` : id;

  // c_limit never enlarges past the original, and f_auto lets Cloudinary pick
  // AVIF or WebP per browser — which is the work Next's own optimiser would
  // otherwise be doing on the app container, on every cold start.
  const transform = `f_auto,c_limit,w_${width},q_${quality || "auto"}`;

  return `https://res.cloudinary.com/${CLOUD}/image/upload/${transform}/${publicId}`;
}
