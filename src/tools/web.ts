import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import * as net from 'node:net';
import { ToolDefinition } from './base';
import { errorMessage, isRecord } from '../shared/errors';
import { HTTP_TIMEOUT_MS, MAX_TOOL_OUTPUT_CHARS, REPO_URL, USER_AGENT } from '../shared/constants';

const MAX_FETCH_BYTES = 1_048_576;
const MAX_REDIRECTS = 5;

export async function readLimitedBody(
  stream: AsyncIterable<Buffer | string>,
  maxBytes: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Response exceeded the ${maxBytes}-byte limit.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = -1, b = -1] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 (TRIP, 9100 portu kötüye kullanımı)
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return true; // IPv4'e eşlenmiş adres
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
    return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8')) return true;
  if (normalized.startsWith('64:ff9b:')) return true; // NAT64 dönüşüm aralığı
  if (normalized.startsWith('2002:')) return true; // 6to4: herhangi bir IPv4 adresini gömebilir
  if (normalized.startsWith('100::')) return true; // yalnızca atım yapılan (discard-only) aralık
  return false;
}

export function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (net.isIPv6(address)) return isPrivateIpv6(address);
  return true;
}

function isNumericHost(host: string): boolean {
  return (
    /^\d+$/.test(host) ||
    /^0x[0-9a-f]+$/i.test(host) ||
    /^0[0-7]+(\.[0-7]+)*$/.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  );
}

export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Bozuk URL: hiçbir ağ erişiminden önce reddedildi.
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    return !isPrivateIp(host);
  }
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    isNumericHost(host)
  ) {
    return false;
  }
  return true;
}

/**
 * URL sözdizimini ve DNS sonuçlarını doğrular. DNS rebinding riskini
 * azaltmak için çözülen her adresi kontrol eder.
 */
export async function assertSafeUrl(value: string): Promise<URL> {
  if (!isPublicHttpUrl(value)) {
    throw new Error('Invalid URL or URL blocked for security reasons.');
  }
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS resolution failed: ${errorMessage(err)}`, { cause: err });
  }
  if (addresses.length === 0) {
    throw new Error('DNS resolution returned no results.');
  }
  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) {
      throw new Error(`Security: "${host}" resolves to a private or reserved IP address (${entry.address}).`);
    }
  }
  return url;
}

async function requestPublicUrl(
  url: URL,
  signal?: AbortSignal
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  if (signal?.aborted) {
    throw new Error('Web request was cancelled.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: Array<{ address: string; family: number }> = [];
  if (!net.isIP(host)) {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new Error(`Security: "${host}" resolves to a private or reserved IP address.`);
    }
  }
  if (signal?.aborted) {
    throw new Error('Web request was cancelled.');
  }

  const pinnedLookup: LookupFunction | undefined =
    addresses.length > 0
      ? (_hostname, options, callback) => {
          if (options && typeof options === 'object' && options.all) {
            callback(null, addresses);
            return;
          }
          const address = addresses[0];
          if (!address) {
            const error = Object.assign(new Error('DNS resolution returned no addresses.'), {
              code: 'ENOTFOUND'
            });
            callback(error, '', 0);
            return;
          }
          callback(null, address.address, address.family);
        }
      : undefined;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.destroy();
      reject(error);
    };
    const onAbort = () => finishWithError(new Error('Web request was cancelled.'));

    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': `${USER_AGENT} (+${REPO_URL})` },
        lookup: pinnedLookup,
        timeout: HTTP_TIMEOUT_MS.web
      },
      (response) => {
        void readLimitedBody(response, MAX_FETCH_BYTES)
          .then((body) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({
              statusCode: response.statusCode || 0,
              headers: response.headers,
              body
            });
          })
          .catch(finishWithError);
      }
    );

    request.on('timeout', () => finishWithError(new Error('Web request timed out.')));
    request.on('error', (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    request.end();
  });
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WebSearchResult {
  title: string;
  url: string;
  text: string;
}

function extractInstantAnswers(data: unknown): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  if (!isRecord(data)) return results;

  if (typeof data.AbstractText === 'string' && data.AbstractText.trim()) {
    results.push({
      title: typeof data.Heading === 'string' ? data.Heading : 'Summary',
      url: typeof data.AbstractURL === 'string' ? data.AbstractURL : '',
      text: data.AbstractText
    });
  }

  // RelatedTopics, DuckDuckGo'dan gelen dış JSON'dur ve iç içe olabilir.
  // Özyineleme yerine açık yığın kullanılır: derinlik dışarıdan gelir ve
  // özyineleme yığın taşmasına yol açabilirdi.
  const queue: unknown[] = Array.isArray(data.RelatedTopics) ? [...data.RelatedTopics] : [];
  while (queue.length > 0 && results.length < 10) {
    const topic = queue.shift();
    if (!isRecord(topic)) continue;

    if (typeof topic.Text === 'string' && typeof topic.FirstURL === 'string') {
      const text = stripHtml(topic.Text);
      results.push({ title: text, url: topic.FirstURL, text });
      continue;
    }
    if (Array.isArray(topic.Topics)) {
      queue.push(...topic.Topics);
    }
  }
  return results.slice(0, 10);
}

/** DuckDuckGo HTML sayfası beklenen işaretlemeyle eşleşmediğinde fırlatılır. */
export class DuckDuckGoMarkupError extends Error {}

/**
 * Getirilen HTML DuckDuckGo sonuç sayfasına benziyorsa doğrudur. İşaretleme
 * değiştiğinde (ya da engel/captcha sayfası geldiğinde) regex ayrıştırıcı
 * hiçbir şey bulamaz; bu kontrol, sessizce boş liste döndürmek yerine
 * gerçek nedeni bildirmeyi sağlar.
 */
export function looksLikeDuckDuckGoResults(html: string): boolean {
  return html.includes('result__a') || html.includes('result__snippet');
}

export function extractDuckDuckGoHtml(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let snippetMatch: RegExpExecArray | null;
  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    if (snippetMatch[1]) {
      snippets.push(stripHtml(snippetMatch[1]));
    }
  }

  let linkMatch: RegExpExecArray | null;
  let index = 0;
  while ((linkMatch = linkPattern.exec(html)) !== null && results.length < 10) {
    const rawUrl = linkMatch[1];
    if (!rawUrl) continue;
    let decoded = rawUrl;
    try {
      const parsed = new URL(rawUrl, 'https://duckduckgo.com');
      decoded = parsed.searchParams.get('uddg') || parsed.toString();
    } catch {
      // yoksay
    }
    results.push({
      title: stripHtml(linkMatch[2] ?? ''),
      url: decoded,
      text: snippets[index] || ''
    });
    index++;
  }
  return results;
}

async function braveSearch(query: string, apiKey: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS.web)
    }
  );
  if (!response.ok) throw new Error(`Brave HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!isRecord(data) || !isRecord(data.web) || !Array.isArray(data.web.results)) return [];
  return data.web.results
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      title: typeof item.title === 'string' ? stripHtml(item.title) : '',
      url: typeof item.url === 'string' ? item.url : '',
      text: typeof item.description === 'string' ? stripHtml(item.description) : ''
    }))
    .filter((item) => item.url);
}

async function tavilySearch(query: string, apiKey: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: 'basic' }),
    signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS.web)
  });
  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!isRecord(data) || !Array.isArray(data.results)) return [];
  return data.results
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title : '',
      url: typeof item.url === 'string' ? item.url : '',
      text: typeof item.content === 'string' ? item.content : ''
    }))
    .filter((item) => item.url);
}

async function duckDuckGoHtmlSearch(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': `Mozilla/5.0 (compatible; ${USER_AGENT})` },
    signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS.web)
  });
  if (!response.ok) throw new Error(`DuckDuckGo HTML HTTP ${response.status}`);
  const html = await response.text();
  const results = extractDuckDuckGoHtml(html);
  if (results.length === 0 && !looksLikeDuckDuckGoResults(html)) {
    throw new DuckDuckGoMarkupError(
      'DuckDuckGo HTML markup was not recognized (layout change or block page)'
    );
  }
  return results;
}

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetches an HTTP/HTTPS page and returns its text content. Local/private network addresses and unsafe redirects are blocked.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The http/https URL to fetch.' },
      maxChars: { type: 'number', description: 'Maximum number of characters (default: 12000).' }
    },
    required: ['url']
  },
  execute: async (args, context) => {
    const input = String(args.url || '').trim();
    const maxChars = Math.min(MAX_TOOL_OUTPUT_CHARS, Math.max(500, Number(args.maxChars) || 12_000));

    try {
      let current = await assertSafeUrl(input);
      let response: { statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer } | undefined;
      let followed = 0;
      for (;;) {
        response = await requestPublicUrl(current, context.signal);
        const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode);
        if (!isRedirect) break;

        const location = response.headers.location;
        if (!location) throw new Error('Redirect location is missing.');
        if (followed >= MAX_REDIRECTS) {
          throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
        }
        followed++;
        current = await assertSafeUrl(new URL(location, current).toString());
      }
      if (!response) throw new Error('No response received.');
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`HTTP ${response.statusCode}`);
      }

      const contentType = response.headers['content-type'] || '';
      const raw = response.body.toString('utf-8');
      const text = contentType.includes('text/html') ? stripHtml(raw) : raw;
      const limited =
        text.length > maxChars
          ? `${text.slice(0, maxChars)}\n... [${text.length - maxChars} content characters truncated]`
          : text;
      return `URL: ${current.toString()}\nContent-Type: ${contentType || '(unknown)'}\n\n${limited || '(empty content)'}`;
    } catch (err) {
      throw new Error(`Failed to fetch web content: ${errorMessage(err)}`, { cause: err });
    }
  }
};

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Searches the web using Brave/Tavily when an API key is available, or the DuckDuckGo HTML interface otherwise.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' }
    },
    required: ['query']
  },
  execute: async (args, context) => {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('Search query cannot be empty.');
    const signal = context.signal;

    try {
      let results: WebSearchResult[] = [];
      let providerError: unknown;
      let markupNote = '';

      // Önce API sağlayıcısı denenir; hata ya da boş sonuç kümesinde turu
      // düşürmek yerine anahtarsız DuckDuckGo yoluna düşülür.
      if (process.env.TAVILY_API_KEY) {
        try {
          results = await tavilySearch(query, process.env.TAVILY_API_KEY, signal);
        } catch (err) {
          providerError = err;
        }
      } else if (process.env.BRAVE_API_KEY) {
        try {
          results = await braveSearch(query, process.env.BRAVE_API_KEY, signal);
        } catch (err) {
          providerError = err;
        }
      }

      if (results.length === 0) {
        try {
          results = await duckDuckGoHtmlSearch(query, signal);
        } catch (err) {
          // Tanınmayan sonuç sayfası sessizce "sonuç yok"a düşürülmek yerine
          // dürüstçe bildirilir; anlık cevap yedeği yine şansını dener.
          if (err instanceof DuckDuckGoMarkupError) {
            markupNote = err.message;
          } else {
            if (providerError) throw providerError;
            throw err;
          }
        }
        if (results.length === 0) {
          const response = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
            { signal: signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS.web) }
          );
          if (response.ok) results = extractInstantAnswers(await response.json());
        }
      }

      if (results.length === 0) {
        const note = markupNote ? ` Note: ${markupNote}.` : '';
        return `No results found for "${query}".${note} Try a more specific query.`;
      }
      const lines = results.map(
        (result, index) =>
          `${index + 1}. ${result.title}${result.url ? `\n   ${result.url}` : ''}\n   ${result.text.slice(0, 400)}`
      );
      return `Web search results (${query}):\n\n${lines.join('\n\n')}`;
    } catch (err) {
      throw new Error(`Web search failed: ${errorMessage(err)}`, { cause: err });
    }
  }
};
