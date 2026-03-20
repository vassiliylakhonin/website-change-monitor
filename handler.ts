type MonitorInput = {
  url: string;
  previous_snapshot?: {
    hash?: string;
    title?: string;
    text?: string;
    sections?: Array<{ heading: string; content_hash: string }>;
  };
  include_text_preview?: boolean;
};

type MonitorOutput = {
  url: string;
  fetched_at: string;
  snapshot: {
    title: string;
    hash: string;
    text_length: number;
    sections: Array<{ heading: string; content_hash: string }>;
  };
  changed: boolean;
  severity: "none" | "low" | "medium" | "high";
  summary: string;
  changes: {
    title_changed: boolean;
    section_changes: {
      added: string[];
      removed: string[];
      modified: string[];
    };
    estimated_change_ratio: number;
  };
  next_checkpoint: {
    snapshot: {
      hash: string;
      title: string;
      text: string;
      sections: Array<{ heading: string; content_hash: string }>;
    };
  };
  text_preview?: {
    before?: string;
    after: string;
  };
};

export default async function handler(input: MonitorInput | Request): Promise<Response | MonitorOutput> {
  if (isRequest(input)) return authMiddleware(input, processMonitor);
  return processMonitor(validateInput(input));
}

async function authMiddleware(request: Request, next: (input: MonitorInput) => Promise<MonitorOutput>) {
  try {
    const body = await request.json();
    const result = await next(validateInput(body));
    return json(result, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("required") || message.includes("must") ? 400 : 500;
    return json({ error: message }, status);
  }
}

async function processMonitor(input: MonitorInput): Promise<MonitorOutput> {
  const page = await fetchPage(input.url);
  const currentText = normalizeText(page.text);
  const currentHash = hashText(currentText);
  const currentSections = extractSections(page.html, currentText);

  const prev = input.previous_snapshot;
  const prevHash = prev?.hash || (prev?.text ? hashText(normalizeText(prev.text)) : "");
  const titleChanged = Boolean(prev?.title && prev.title !== page.title);

  const prevSectionMap = new Map((prev?.sections || []).map((s) => [normalizeHeading(s.heading), s.content_hash]));
  const currSectionMap = new Map(currentSections.map((s) => [normalizeHeading(s.heading), s.content_hash]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [h, hash] of currSectionMap.entries()) {
    if (!prevSectionMap.has(h)) added.push(h);
    else if (prevSectionMap.get(h) !== hash) modified.push(h);
  }
  for (const h of prevSectionMap.keys()) {
    if (!currSectionMap.has(h)) removed.push(h);
  }

  const ratio = estimateChangeRatio(prev?.text || "", currentText);
  const changed = Boolean(prevHash) ? prevHash !== currentHash : true;
  const severity = getSeverity(changed, ratio, titleChanged, added.length + removed.length + modified.length);

  const summary = !prevHash
    ? "Initial snapshot created."
    : !changed
      ? "No meaningful changes detected."
      : `Detected changes: ${titleChanged ? "title, " : ""}${modified.length} modified sections, ${added.length} added, ${removed.length} removed.`;

  const out: MonitorOutput = {
    url: page.url,
    fetched_at: new Date().toISOString(),
    snapshot: {
      title: page.title,
      hash: currentHash,
      text_length: currentText.length,
      sections: currentSections,
    },
    changed,
    severity,
    summary,
    changes: {
      title_changed: titleChanged,
      section_changes: { added, removed, modified },
      estimated_change_ratio: round(ratio, 3),
    },
    next_checkpoint: {
      snapshot: {
        hash: currentHash,
        title: page.title,
        text: currentText,
        sections: currentSections,
      },
    },
  };

  if (input.include_text_preview) {
    out.text_preview = {
      before: prev?.text ? normalizeText(prev.text).slice(0, 500) : undefined,
      after: currentText.slice(0, 500),
    };
  }

  return out;
}

async function fetchPage(rawUrl: string) {
  const response = await fetch(rawUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; WebsiteChangeMonitor/1.0)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Failed to fetch page: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/html|xml/i.test(contentType)) throw new Error(`Unsupported content type: ${contentType || "unknown"}`);

  const html = await response.text();
  return {
    url: response.url || rawUrl,
    title: extractTitle(html),
    html,
    text: stripTags(html),
  };
}

function validateInput(input: unknown): MonitorInput {
  if (!input || typeof input !== "object") throw new Error("Request body must be a JSON object");
  const body = input as MonitorInput;
  if (!body.url || typeof body.url !== "string") throw new Error("url is required");
  const parsed = new URL(body.url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url must be http or https");
  return {
    url: parsed.toString(),
    previous_snapshot: body.previous_snapshot,
    include_text_preview: body.include_text_preview,
  };
}

function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeHtml(m[1]).trim() : "";
}

function extractSections(html: string, fullText: string): Array<{ heading: string; content_hash: string }> {
  const regex = /<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  const headings: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html))) {
    const h = normalizeHeading(decodeHtml(stripTags(m[2])));
    if (h) headings.push(h);
  }
  if (!headings.length) return [{ heading: "document", content_hash: hashText(fullText) }];
  return headings.slice(0, 50).map((h) => ({ heading: h, content_hash: hashText(`${h}::${fullText.slice(0, 5000)}`) }));
}

function estimateChangeRatio(prev: string, curr: string): number {
  if (!prev) return 1;
  const a = prev.slice(0, 20000);
  const b = curr.slice(0, 20000);
  const maxLen = Math.max(a.length, b.length) || 1;
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
  return clamp(1 - same / maxLen, 0, 1);
}

function getSeverity(changed: boolean, ratio: number, titleChanged: boolean, sectionSignals: number) {
  if (!changed) return "none" as const;
  if (titleChanged || ratio > 0.35 || sectionSignals >= 8) return "high" as const;
  if (ratio > 0.12 || sectionSignals >= 3) return "medium" as const;
  return "low" as const;
}

function normalizeText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeHeading(s: string) {
  return normalizeText(s).toLowerCase();
}

function stripTags(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function hashText(input: string) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isRequest(v: unknown): v is Request {
  return typeof v === "object" && v !== null && "json" in v && typeof (v as Request).json === "function";
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, d: number) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}
