/* Two gradients of the Seams site, as data: named fields of
   packages/grain-field-ts in seams-monorepo (commit 3407f157), without the
   generator of custom fields: Apricot Beam (Light mode) and Aqua Evergreen
   (Dark mode). Every field is a 12 x 12 grid of RGB colours,
   the cubic B-spline control points of a fitted photograph, in base64 with
   rows top to bottom. The shader (renderer.ts) smooths it, flows it and
   covers it with grain, so no gradient costs an image download. */

export const GRAIN_FIELD_GRID_SIZE = 12;

export type GrainFieldSource = {
  key: string;
  grid: Uint8Array;
  /* a photograph keeps its shape and crops like background-size: cover */
  fit: 'cover' | 'stretch';
  /* mean colour, shown until the first frame */
  base: string;
  /* the relative luminance of the mean colour, 0 to 1 */
  luminance: number;
};

const PHOTO_FIELDS = {
  'apricot-beam':
    'EkuIE1aQElWREE+LD0qHEEmIEkuMFU6QFlGMFE1xEj9YDjJGDEmHCkqHC0eECUqECUl/C0iBCUZ9BUZ/A0RxDDNAHhghFxYgCUyJB0aDCEWCC0qHDEqHB0iECEl/DkmJEURvESYvGxEUEA4LCk2LC0uKCkuJB0yJCEqHEEmJEEaHAEiHClF9QT47ijk1WzcvCFGPCFCPCU+ODE6NDUqKAU6KB2SNV4qVvamR7rJ6/5FXmEA7BVaUB1ORCVORBE6NAFuROIKZyauX/8KV/8eM8qNvsklAJig1AFyVAVeTAFWSAGGWUImc8bST/8iT+saM8rl/z2JEWiw2HicyAFyZAFyXAGCWP4Wg6aua+8SR88OM9L6F631ThDk9Ny4yGCY2AGOYAGSaGXuhxp2g97OR7sCK97F34nRQfDI4JSs2IBMaByExAGacDHKeh5Oj66mZ9LeL9qdzzmdSZzA5HCQvFxghCAUTCCs+AGuiPYKh0aCf6KSN6ad93n9Vgjg7IiszHBUdCwsaCA8cCzdKAHingJak5qea756C2IRjpVI+UCQsGxooEQ8fBxAgCR8vCjlN',
  'aqua-evergreen':
    'KWVfQH+JVpWnXZmwa6C4baG5eaa7e6m4f666bp6vW5CjJVdubaaZgr23hr7ClMbUnMfaosbarMrbt87ewNXdss3bl8PTVJSyhbmcncnCn83HpMzZpc3drc3ivNfkxtbjxtngvtPcpcXWaqS9nsivtdjDtNfQsdnYrtPfrtDlwtro1OLp0N/sxtnkstLfe67Jqc6wx9/MxOHOutvXp9HTnM7Yqs3bvtjjzeDkwNXfrMrabqnGocmzyeDMx+DNwN/NptPJiMHBhL+/kcDDmMXGk8HCf7jCS46qkcGus9jDwN7NutvIoM+8gbyqZ6ylYqaYYKGOVZuLPo2BJ250a6udoMy/qdDAqtXAl8atarSlUJ2OR5KBNH1jMHFQIFlDD0dBVZWSgr2tj8Syl8eugbykVaGVPJOPK31vI2tRG1RBFko7CTAqKWJraqufda6fdrCYXZ2IO46CJHF1HWhnElJJEko+CzcxCC8oE0FWPoJ7SJJ+RIZzOXlmJmleHmJhFFNWEUlLCzg6CzIyCSkpBx0uDTNDF0ZIE0I4F0E1EjQsEjEzCzA0CjA5CC8xBB8lBiEd',
} as const;

export type GrainFieldName = keyof typeof PHOTO_FIELDS;

function meanColour(grid: Uint8Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < grid.length; i += 3) {
    r += grid[i] ?? 0;
    g += grid[i + 1] ?? 0;
    b += grid[i + 2] ?? 0;
  }
  const cells = grid.length / 3;
  return [r / cells, g / cells, b / cells];
}

function hex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/* WCAG relative luminance of an sRGB colour. */
function luminanceOf([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function decodeGrid(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const sources = new Map<GrainFieldName, GrainFieldSource>();

export function grainFieldSource(field: GrainFieldName): GrainFieldSource {
  const cached = sources.get(field);
  if (cached) return cached;
  const grid = decodeGrid(PHOTO_FIELDS[field]);
  const mean = meanColour(grid);
  const source: GrainFieldSource = { key: field, grid, fit: 'cover', base: hex(mean), luminance: luminanceOf(mean) };
  sources.set(field, source);
  return source;
}
