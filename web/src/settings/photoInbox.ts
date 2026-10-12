// The logic behind Settings → Photo inbox, kept out of the component so it can
// be tested without rendering.

import type { Product } from "../api/types";

/** Mirrors product_photos.MAX_PHOTOS on the server. */
export const MAX_PHOTOS_PER_PRODUCT = 8;

export interface BatchResult {
  uploaded: number;
  failed: { name: string; message: string }[];
}

/** Upload a batch a few at a time.
 *
 * Each file is its own request, so one bad file (wrong type, too big) is
 * reported by name and the rest still go up. A small pool rather than all at
 * once: thirty 5 MB phone photos in parallel would stall a shop wifi.
 */
export async function uploadBatch(
  files: File[],
  upload: (file: File) => Promise<unknown>,
  onProgress: (done: number, total: number) => void = () => {},
  concurrency = 3,
): Promise<BatchResult> {
  const result: BatchResult = { uploaded: 0, failed: [] };
  let next = 0;
  let done = 0;
  onProgress(0, files.length);

  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        await upload(file);
        result.uploaded += 1;
      } catch (e) {
        result.failed.push({
          name: file.name,
          message: e instanceof Error ? e.message : "Upload failed.",
        });
      }
      done += 1;
      onProgress(done, files.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return result;
}

export interface ProductOption {
  id: number;
  label: string;
  /** A full gallery can't take another photo; the server would refuse. */
  disabled: boolean;
}

export interface ProductOptionGroup {
  category: string;
  options: ProductOption[];
}

/** The product picker: grouped by category, alphabetical, and saying which
 *  products still have no photo — usually the ones being sorted for. */
export function productOptions(products: Product[]): ProductOptionGroup[] {
  const groups = new Map<string, ProductOption[]>();
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    const category = p.category?.trim() || "Uncategorised";
    const count = p.photos.length;
    const full = count >= MAX_PHOTOS_PER_PRODUCT;
    const note = full ? " (full)" : count === 0 ? " (no photo yet)" : ` (${count} photo${count === 1 ? "" : "s"})`;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push({ id: p.id, label: p.name + note, disabled: full });
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === "Uncategorised" ? 1 : b === "Uncategorised" ? -1 : a.localeCompare(b),
    )
    .map(([category, options]) => ({ category, options }));
}
