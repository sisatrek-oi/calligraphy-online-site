const SEARCH_URL = "https://html.duckduckgo.com/html/";

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripTags(fragment = "") {
  return decodeHtml(fragment.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResultUrl(rawUrl = "") {
  let value = decodeHtml(rawUrl);
  if (value.startsWith("//")) value = `https:${value}`;
  if (value.startsWith("/l/")) {
    const parsed = new URL(value, "https://duckduckgo.com");
    value = parsed.searchParams.get("uddg") || value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseResults(document) {
  let blocks = [...document.matchAll(/<div[^>]+class="result results_links.*?<\/div>\s*<\/div>\s*<\/div>/gs)].map(
    (match) => match[0],
  );
  if (!blocks.length) {
    blocks = [
      ...document.matchAll(/<a[^>]+class="result__a".*?<\/a>.*?(?=<a[^>]+class="result__a"|$)/gs),
    ].map((match) => match[0]);
  }

  const results = [];
  for (const block of blocks) {
    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/s);
    if (!titleMatch) continue;

    const snippetMatch =
      block.match(/<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/s) ||
      block.match(/<div[^>]+class="result__snippet"[^>]*>(.*?)<\/div>/s);
    const title = stripTags(titleMatch[2]);
    const url = normalizeResultUrl(titleMatch[1]);
    const snippet = stripTags(snippetMatch?.[1] || "");

    if (title && url && !results.some((item) => item.url === url)) {
      results.push({ title, url, snippet });
    }
    if (results.length >= 8) break;
  }
  return results;
}

function sendJson(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(status).json(payload);
}

export default async function handler(request, response) {
  const query = String(request.query?.q || "").trim();
  if (!query) {
    sendJson(response, 400, { query: "", results: [], error: "missing query" });
    return;
  }

  try {
    const duckBody = new URLSearchParams({ q: query, kl: "cn-zh" });
    const searchResponse = await fetch(SEARCH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      },
      body: duckBody,
    });

    if (!searchResponse.ok) {
      throw new Error(`DuckDuckGo responded ${searchResponse.status}`);
    }
    const document = await searchResponse.text();
    const results = parseResults(document);
    sendJson(response, 200, { query, results });
  } catch (error) {
    sendJson(response, 502, {
      query,
      results: [],
      error: `search unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
