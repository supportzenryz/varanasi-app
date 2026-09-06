import fs from "node:fs";

/**
 * The pixel dimensions of a JPEG, PNG or WebP, read from its header.
 *
 * Written out rather than installed because the alternative is a dependency in
 * `package.json` — and therefore in the production image, and in every audit —
 * for something used once, by a seed script, on files that are already sitting
 * on the disk beside it. Only the first few hundred bytes of each file are
 * read.
 *
 * WHY THE SEED CARES HOW BIG A PHOTOGRAPH IS
 *
 * The gallery gives some tiles four times the area of the others. A 2,000px
 * photograph carries that; a 201px one, which is what a couple of the client's
 * Leicester files turned out to be, is a smear at any size a browser would ask
 * of it. Nothing in the file name or the database said which was which, so the
 * layout was handing the biggest slot on the page to whichever picture the sort
 * order happened to end on. Knowing the real size lets the large slots go to
 * the photographs that can fill them.
 */
export function imageSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const head = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    const buf = head.subarray(0, read);

    // PNG: IHDR is always the first chunk, width and height at bytes 16-23.
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    // WebP: RIFF....WEBP, then one of three chunk layouts.
    if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      const fourcc = buf.toString("ascii", 12, 16);
      if (fourcc === "VP8 ") {
        // Lossy: 14-bit dimensions after the 3-byte start code at offset 23.
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === "VP8L") {
        // Lossless: 14 bits each, packed across four bytes after the signature.
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === "VP8X") {
        // Extended: 24-bit canvas size, stored minus one.
        const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
        const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
        return { width: w + 1, height: h + 1 };
      }
      return null;
    }

    // JPEG: walk the markers to the frame header, which is the only place the
    // dimensions live. Skipping by segment length rather than scanning for
    // 0xFFC0 matters — those two bytes occur inside compressed data too.
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const length = buf.readUInt16BE(i + 2);
        // SOF0-SOF15, less the four that are not frame headers.
        const isFrame = marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && marker !== 0xc9;
        if (isFrame) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + length;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
