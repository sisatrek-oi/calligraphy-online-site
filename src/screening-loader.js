import { validCollation, publicationSummary } from './team-collation.js?v=20261018-part4';
import { validTargeted, targetedSummary } from './targeted-ocr.js?v=20261018-part4';
// Keep the deadline active through body parsing, not just response headers.
export async function readJson(url, { fetcher = fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { signal: controller.signal, cache: 'default' });
        if (!response.ok) throw new Error(`材料读取失败（HTTP ${response.status}）`);
        return response.json();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('材料读取超时，请检查网络后重试'));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function createMaterialLoader(data, options = {}) {
  const requests = new Map();
  const entries = data.pages;
  const pages = new Map(entries.map(item => [item.page, item]));
  const paths = [...new Set(Object.values(data.materials || {}))];
  async function load(path) {
    if (!path) throw new Error('本页材料索引缺失');
    if (!requests.has(path)) {
      const request = readJson(`./screening-data/${path}`, options).then(payload => {
        const expected = entries.filter(item => data.materials[item.page] === path);
        const valid = payload.version === 1 && payload.part === data.part &&
          Array.isArray(payload.pages) && payload.pages.length === expected.length &&
          payload.pages.every((item, i) => item.page === expected[i].page &&
            typeof item.ocr === 'string' && typeof item.layout?.text === 'string' &&
            typeof item.contextual?.normalized === 'string' && typeof item.contextual?.conservative === 'string' &&
            Array.isArray(item.contextual?.uncertainties) &&
            (item.collated === undefined ? expected[i].publication === undefined :
              validCollation(item.collated, item.page) &&
              JSON.stringify(publicationSummary(item.collated)) === JSON.stringify(expected[i].publication)) &&
            (item.targeted === undefined ? expected[i].targetedSummary === undefined :
              validTargeted(item.targeted, item.page, item.ocr) &&
              JSON.stringify(targetedSummary(item.targeted)) === JSON.stringify(expected[i].targetedSummary)));
        if (!valid) throw new Error('本页材料不完整或与页码索引不匹配');
        // Attach only after validating the entire chunk. Never touch local reviews.
        for (const item of payload.pages) Object.assign(pages.get(item.page), {
          ocr: item.ocr, layout: item.layout, contextual: item.contextual,
          ...(item.collated ? { collated: item.collated } : {}),
          ...(item.targeted ? { targeted: item.targeted } : {}),
        });
      }).catch(error => { requests.delete(path); throw error; });
      requests.set(path, request);
    }
    return requests.get(path);
  }
  return {
    ensurePage: number => load(data.materials?.[number]),
    async ensureAll() {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, paths.length) }, async () => {
        while (next < paths.length) await load(paths[next++]);
      }));
    },
  };
}
