/**
 * 데이터 도우미 중계 서버 (Cloudflare Worker) · Data Helper relay server
 *
 * 챗봇 화면(index.html)과 OpenAI · Notion · GitHub 사이를 이어 줍니다.
 * API 키와 토큰은 이 서버에만 저장되므로, 챗봇 화면 코드에는 노출되지 않습니다.
 * 오류 메시지는 챗봇이 보내는 x-lang 헤더(ko / en)에 맞춰 한국어 또는 영어로 돌려줍니다.
 *
 * Cloudflare 대시보드 → Worker → Settings → Variables and Secrets 에 아래 값을 넣습니다.
 *   OPENAI_API_KEY         (Secret)  platform.openai.com 에서 발급한 API 키
 *   OPENAI_MODEL           (Text, 선택) 기본값 gpt-5.4-mini
 *   OPENAI_BASE_URL        (Text, 선택) 기본값 https://api.openai.com/v1
 *   OPENAI_SEARCH_MODEL    (Text, 선택) 인터넷 검색에 쓸 모델. 기본값은 OPENAI_MODEL과 같음
 *   WEB_SEARCH             (Text, 선택) off 로 적으면 OpenAI 인터넷 검색을 끔
 *   TAVILY_API_KEY         (Secret, 선택) tavily.com 무료 키 (월 1,000회, 카드 등록 없음). 넣으면 인터넷 검색이 더 안정적
 *   BRAVE_API_KEY          (Secret, 선택) Brave Search API 키
 *   (위 두 키가 없으면 키 없이 DuckDuckGo로 인터넷 전체를 검색합니다)
 *   NOTION_TOKEN           (Secret)  Notion 통합(Integration)의 시크릿
 *   NOTION_PARENT_PAGE_ID  (Text)    새 페이지를 만들 상위 페이지의 URL 또는 ID
 *   GITHUB_TOKEN           (Secret)  Fine-grained 토큰 (Contents: Read and write)
 *   GITHUB_REPO            (Text)    예: Onejunpyo/2229455-
 *   GITHUB_BRANCH          (Text, 선택) 기본값 main
 *   ALLOWED_ORIGIN         (Text)    챗봇 주소. 예: https://onejunpyo.github.io  (여러 개는 쉼표로 구분)
 *   ACCESS_CODE            (Secret, 권장) 챗봇 설정 창에 입력할 접근 코드
 */

const DEFAULT_MODEL = "gpt-5.4-mini";

const MSG = {
  ko: {
    badOrigin: "허용되지 않은 주소에서 온 요청입니다. Worker의 ALLOWED_ORIGIN 설정을 확인해 주십시오.",
    badCode: "접근 코드가 맞지 않습니다. 챗봇 설정 창에서 접근 코드를 확인해 주십시오.",
    postOnly: "POST 요청만 받습니다.", unknownPath: "알 수 없는 주소입니다.",
    noOpenAI: "OpenAI API 키(OPENAI_API_KEY)가 설정되지 않았습니다.", noMessages: "보낼 대화 내용이 없습니다.",
    rate: "OpenAI 사용량 한도를 잠시 넘었습니다. 잠시 뒤에 다시 해 주십시오.",
    quota: "OpenAI 계정의 크레딧이 부족합니다. platform.openai.com 의 Billing에서 결제 정보를 확인해 주십시오.",
    badKey: "OpenAI API 키가 올바르지 않습니다. Worker의 OPENAI_API_KEY를 확인해 주십시오.",
    badModel: m => `OpenAI 모델 '${m}'을(를) 쓸 수 없습니다. Worker의 OPENAI_MODEL 값을 확인해 주십시오.`,
    openaiErr: m => `OpenAI 오류: ${m}`, wikiErr: st => `위키백과에 접속하지 못했습니다 (HTTP ${st}).`, allEngines: list => `모든 검색 엔진이 실패했습니다. ${list.join(" / ")}`, webErr: (p, e) => `${p} 검색에 실패했습니다 (${e}).`, ddgBlocked: "DuckDuckGo가 자동 검색을 잠시 막았습니다. 잠시 뒤에 다시 하거나, Worker에 TAVILY_API_KEY(무료)를 넣으면 안정적으로 검색됩니다.", noQuery: "검색할 내용이 비어 있습니다.", searchOff: "중계 서버에서 인터넷 검색이 꺼져 있습니다(WEB_SEARCH=off).",
    noNotion: "Notion 토큰(NOTION_TOKEN)이 설정되지 않았습니다.",
    notionNotFound: "Notion 페이지를 찾을 수 없습니다. 그 페이지의 ⋯ 메뉴 → 연결(Connections)에서 이 통합을 추가했는지 확인해 주십시오.",
    notionErr: m => `Notion 오류: ${m}`, badPageId: "Notion 페이지 주소나 ID를 알아볼 수 없습니다.",
    noParent: "새 페이지를 만들 상위 페이지(NOTION_PARENT_PAGE_ID)가 설정되지 않았습니다.",
    defaultTitle: "데이터 도우미 기록", emptyAppend: "덧붙일 내용이 비어 있습니다.",
    table: "[표]", image: "[이미지]", attachment: "[첨부]",
    noGithub: "GitHub 토큰(GITHUB_TOKEN) 또는 저장소(GITHUB_REPO)가 설정되지 않았습니다.",
    ghNotFound: "GitHub에서 그 파일이나 폴더를 찾을 수 없습니다.",
    ghPerm: "GitHub 토큰의 권한이 부족합니다. 토큰에 Contents 읽기/쓰기 권한이 있는지 확인해 주십시오.",
    ghErr: m => `GitHub 오류: ${m}`, needPath: "읽을 파일 경로가 필요합니다.", isFolder: "파일이 아니라 폴더입니다. 파일 이름까지 알려 주십시오.",
    tooBig: "이 파일은 너무 크거나 글자로 읽을 수 없습니다.", needWritePath: "저장할 파일 경로가 필요합니다.", noContent: "저장할 내용이 없습니다.",
    saveMsg: p => `데이터 도우미: ${p} 저장`
  },
  en: {
    badOrigin: "This request came from an address that is not allowed. Check the Worker's ALLOWED_ORIGIN setting.",
    badCode: "The access code is incorrect. Check the access code in the chatbot settings.",
    postOnly: "Only POST requests are accepted.", unknownPath: "Unknown path.",
    noOpenAI: "The OpenAI API key (OPENAI_API_KEY) is not set.", noMessages: "There are no messages to send.",
    rate: "The OpenAI rate limit was exceeded for now. Please try again shortly.",
    quota: "Your OpenAI account is out of credit. Check Billing at platform.openai.com.",
    badKey: "The OpenAI API key is invalid. Check the Worker's OPENAI_API_KEY.",
    badModel: m => `The OpenAI model '${m}' is not available. Check the Worker's OPENAI_MODEL value.`,
    openaiErr: m => `OpenAI error: ${m}`, wikiErr: st => `Could not reach Wikipedia (HTTP ${st}).`, allEngines: list => `All search engines failed. ${list.join(" / ")}`, webErr: (p, e) => `${p} search failed (${e}).`, ddgBlocked: "DuckDuckGo temporarily blocked automated searches. Try again later, or add a free TAVILY_API_KEY to the Worker for reliable search.", noQuery: "There is nothing to search for.", searchOff: "Internet search is turned off on the relay server (WEB_SEARCH=off).",
    noNotion: "The Notion token (NOTION_TOKEN) is not set.",
    notionNotFound: "The Notion page was not found. Make sure you added this integration under the page's ⋯ menu → Connections.",
    notionErr: m => `Notion error: ${m}`, badPageId: "Could not recognize the Notion page URL or ID.",
    noParent: "The parent page for new pages (NOTION_PARENT_PAGE_ID) is not set.",
    defaultTitle: "Data Helper notes", emptyAppend: "There is nothing to append.",
    table: "[table]", image: "[image]", attachment: "[attachment]",
    noGithub: "The GitHub token (GITHUB_TOKEN) or repository (GITHUB_REPO) is not set.",
    ghNotFound: "That file or folder was not found on GitHub.",
    ghPerm: "The GitHub token lacks permission. Make sure it has Contents read and write access.",
    ghErr: m => `GitHub error: ${m}`, needPath: "A file path is needed.", isFolder: "That is a folder, not a file. Please give the file name too.",
    tooBig: "This file is too large or cannot be read as text.", needWritePath: "A file path to save to is needed.", noContent: "There is no content to save.",
    saveMsg: p => `Data Helper: save ${p}`
  }
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);
    const m = MSG[request.headers.get("x-lang") === "en" ? "en" : "ko"];
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (env.ALLOWED_ORIGIN && origin && !originAllowed(env, origin)) return json({ error: m.badOrigin }, 403);
      const url = new URL(request.url);
      const codeOk = !env.ACCESS_CODE || request.headers.get("x-access-code") === env.ACCESS_CODE;

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          ok: true,
          authorized: codeOk,
          needsCode: !!env.ACCESS_CODE,
          openai: !!env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL || DEFAULT_MODEL,
          wiki: true,
          web: true,
          webProvider: engineNames(env).join(" + "),
          search: !!env.OPENAI_API_KEY && String(env.WEB_SEARCH || "").toLowerCase() !== "off",
          notion: !!env.NOTION_TOKEN,
          notionParent: !!env.NOTION_PARENT_PAGE_ID,
          github: !!(env.GITHUB_TOKEN && env.GITHUB_REPO),
          repo: env.GITHUB_REPO || null,
          branch: env.GITHUB_BRANCH || "main"
        });
      }
      if (!codeOk) return json({ error: m.badCode }, 401);
      if (request.method !== "POST") return json({ error: m.postOnly }, 405);

      const body = await request.json().catch(() => ({}));
      switch (url.pathname) {
        case "/chat": return json(await openaiChat(env, body, m));
        case "/search": return json(await webSearch(env, body, m));
        case "/wiki": return json(await wikiSearch(env, body, m));
        case "/web": return json(await webSearchFree(env, body, m));
        case "/notion/search": return json(await notionSearch(env, body, m));
        case "/notion/read": return json(await notionRead(env, body, m));
        case "/notion/create": return json(await notionCreate(env, body, m));
        case "/notion/append": return json(await notionAppend(env, body, m));
        case "/github/list": return json(await githubList(env, body, m));
        case "/github/read": return json(await githubRead(env, body, m));
        case "/github/write": return json(await githubWrite(env, body, m));
        default: return json({ error: m.unknownPath }, 404);
      }
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500);
    }
  }
};

/* ---------------- 공통 ---------------- */
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function allowedList(env) {
  return String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
}
function originAllowed(env, origin) {
  return allowedList(env).includes(origin.replace(/\/+$/, ""));
}
function corsHeaders(env, origin) {
  const list = allowedList(env);
  const allow = !list.length ? "*" : (list.includes(origin) ? origin : list[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-access-code, x-lang",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/* ---------------- OpenAI (Chat Completions + 도구 호출) ---------------- */
async function openaiChat(env, body, m) {
  if (!env.OPENAI_API_KEY) fail(m.noOpenAI);
  if (!Array.isArray(body.messages) || !body.messages.length) fail(m.noMessages);
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;
  // 모델과 옵션은 서버에서 정합니다. 화면에서는 대화 내용과 도구 목록만 받습니다.
  const payload = { model, messages: body.messages };
  if (Array.isArray(body.tools) && body.tools.length) { payload.tools = body.tools; payload.tool_choice = "auto"; }
  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  });
  return readOpenAI(r, m, model);
}
async function readOpenAI(r, m, model) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = j.error || {};
    if (r.status === 401) fail(m.badKey, 401);
    if (r.status === 429) fail(err.code === "insufficient_quota" ? m.quota : m.rate, 429);
    if (r.status === 404 || err.code === "model_not_found") fail(m.badModel(model), r.status);
    fail(m.openaiErr(err.message || `HTTP ${r.status}`), r.status);
  }
  return j;
}

/* ---------------- 인터넷 전체 검색 (OpenAI 없이) ----------------
   Tavily 키 → Brave 키 → (키 없음) DuckDuckGo 순서로 검색하고,
   위쪽 결과 3개는 페이지 본문도 가져와서 챗봇이 질문과 가장 관련 있는 문장을 찾을 수 있게 합니다. */
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ""; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch (e) { return ""; } })
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const cleanText = h => decodeEntities(String(h || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
async function fetchTimeout(url, init = {}, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(timer); }
}
function ddgUrl(href) {
  let u = decodeEntities(href);
  const mm = u.match(/[?&]uddg=([^&]+)/);
  if (mm) u = decodeURIComponent(mm[1]);
  if (u.startsWith("//")) u = "https:" + u;
  return /^https?:\/\//.test(u) && !/duckduckgo\.com\/(y\.js|l\/)/.test(u) ? u : null;
}
function parseDdgHtml(html) {
  const out = [];
  const blocks = html.split(/(?=<div[^>]+class="[^"]*\bresult\b[^"]*")/i).filter(b => /^<div/i.test(b));
  for (const b of blocks) {
    if (/result--ad/i.test(b.slice(0, 300))) continue;
    const a = b.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) || b.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = ddgUrl(a[1]);
    if (!url) continue;
    const sn = b.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i);
    out.push({ title: cleanText(a[2]), url, snippet: sn ? cleanText(sn[1]) : "" });
  }
  return out;
}
function parseDdgLite(html) {
  const out = [];
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=["']result-link["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const snips = [...html.matchAll(/<td[^>]+class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi)].map(x => cleanText(x[1]));
  links.forEach((l, i) => { const url = ddgUrl(l[1] || l[3]); if (url) out.push({ title: cleanText(l[2] || l[4]), url, snippet: snips[i] || "" }); });
  return out;
}
const ddgBlockedPage = html => /anomaly-modal|bots use DuckDuckGo|challenge-form|g-recaptcha/i.test(html);
async function searchDuckDuckGo(query, lang, m) {
  const kl = lang === "en" ? "us-en" : "kr-kr";
  const headers = { "User-Agent": BROWSER_UA, "content-type": "application/x-www-form-urlencoded", "Accept-Language": lang === "en" ? "en-US,en;q=0.8" : "ko-KR,ko;q=0.9,en;q=0.6" };
  const body = `q=${encodeURIComponent(query)}&kl=${kl}`;
  let blocked = false;
  try {
    const r = await fetchTimeout("https://html.duckduckgo.com/html/", { method: "POST", headers, body });
    const html = await r.text();
    if (ddgBlockedPage(html)) blocked = true;
    else { const res = parseDdgHtml(html); if (res.length) return res; }
  } catch (e) { /* lite 버전으로 다시 시도 */ }
  try {
    const r = await fetchTimeout("https://lite.duckduckgo.com/lite/", { method: "POST", headers, body });
    const html = await r.text();
    if (ddgBlockedPage(html)) blocked = true;
    else { const res = parseDdgLite(html); if (res.length) return res; }
  } catch (e) { /* 아래에서 처리 */ }
  if (blocked) fail(m.ddgBlocked, 503);
  return [];
}
async function searchTavily(env, query, m) {
  const r = await fetchTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: 6, include_answer: "basic", search_depth: "basic" })
  }, 15000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(m.webErr("Tavily", (j.detail && (j.detail.error || j.detail)) || r.status), r.status);
  return { answer: j.answer || "", results: (j.results || []).map(x => ({ title: x.title || "", url: x.url, snippet: String(x.content || "").slice(0, 600) })) };
}
async function searchBrave(env, query, lang, m) {
  const r = await fetchTimeout(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&search_lang=${lang === "en" ? "en" : "ko"}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": env.BRAVE_API_KEY }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(m.webErr("Brave", r.status), r.status);
  return { answer: "", results: ((j.web || {}).results || []).map(x => ({ title: cleanText(x.title), url: x.url, snippet: cleanText(x.description) })) };
}
// 웹 페이지에서 본문 글자만 뽑기
async function pageText(url) {
  try {
    // 네이버 블로그 글은 본문이 안쪽 틀(iframe)에 있으므로, 본문이 바로 보이는 모바일 주소로 읽습니다
    const readUrl = url.replace(/^https?:\/\/blog\.naver\.com\//, "https://m.blog.naver.com/");
    const r = await fetchTimeout(readUrl, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow" }, 6000);
    if (!r.ok || !/text\/html|xhtml/i.test(r.headers.get("content-type") || "")) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 3000000) return null;
    let cs = ((r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1];
    let html = new TextDecoder("utf-8").decode(buf);
    if (!cs) cs = (html.slice(0, 3000).match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    if (cs && !/utf-?8/i.test(cs)) { try { html = new TextDecoder(cs.toLowerCase()).decode(buf); } catch (e) { /* utf-8 그대로 */ } }
    const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    // <head>(제목·설정)와 스크립트 등은 지우고, 본문(article·main)이 있으면 그 부분만 씁니다
    let body = html.replace(/<head[\s\S]*?<\/head>/i, " ").replace(/<(script|style|noscript|svg|iframe|template|form)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
    const main = body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
    if (main && main[2].replace(/<[^>]+>/g, "").trim().length > 300) body = main[2];
    else body = body.replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ");
    const text = decodeEntities(body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
      .split("\n").map(l => l.replace(/[ \t ]+/g, " ").trim()).filter(l => l.length > 1).join("\n\n");
    return text.length > 80 ? { url, title, text: text.slice(0, 15000) } : null;
  } catch (e) { return null; }
}
function engineNames(env) {
  return [env.TAVILY_API_KEY ? "Tavily" : env.BRAVE_API_KEY ? "Brave" : "DuckDuckGo"];
}
function interleave(lists) {
  const out = [], n = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < n; i++) lists.forEach(l => { if (l[i]) out.push(l[i]); });
  return out;
}
async function webSearchFree(env, body, m) {
  const query = String(body.query || "").trim().slice(0, 300);
  if (!query) fail(m.noQuery);
  const lang = body.lang === "en" ? "en" : "ko";
  const names = engineNames(env);
  const jobs = names.map(name =>
    name === "Tavily" ? searchTavily(env, query, m)
    : name === "Brave" ? searchBrave(env, query, lang, m)
    : searchDuckDuckGo(query, lang, m).then(results => ({ results })));
  const settled = await Promise.allSettled(jobs);
  const ok = [], errors = [];
  settled.forEach((x, i) => {
    if (x.status === "fulfilled" && x.value.results.length) ok.push({ name: names[i], ...x.value, results: x.value.results.map(r => ({ engine: names[i], ...r })) });
    else if (x.status === "rejected") errors.push(`${names[i]}: ${x.reason && x.reason.message}`);
  });
  if (!ok.length && errors.length) fail(m.allEngines(errors), 502);
  const seen = new Set();
  const results = interleave(ok.map(o => o.results)).filter(x => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 10);
  const answer = (ok.find(o => o.answer) || {}).answer || "";
  // 위쪽 결과 4개의 본문을 동시에 가져옴 (느린 사이트는 6초 뒤 건너뜀)
  const pages = (await Promise.all(results.slice(0, 4).map(x => pageText(x.url)))).filter(Boolean);
  return { provider: ok.map(o => o.name).join(" + ") || names.join(" + "), query, answer, results, pages, warnings: errors.length ? errors : undefined };
}

/* ---------------- 위키백과 검색 (키 필요 없음 · 브라우저에서 막혔을 때 대신 검색) ---------------- */
async function wikiSearch(env, body, m) {
  const query = String(body.query || "").trim().slice(0, 300);
  if (!query) fail(m.noQuery);
  const H = { "User-Agent": "DataHelperChatbot/1.0 (Cloudflare Worker; student project)", "Api-User-Agent": "DataHelperChatbot/1.0" };
  const safe = u => u.replace(/\(/g, "%28").replace(/\)/g, "%29");
  const strip = h => String(h || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
  for (const lang of body.lang === "en" ? ["en", "ko"] : ["ko", "en"]) {
    const base = `https://${lang}.wikipedia.org`;
    const r = await fetch(`${base}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`, { headers: H });
    if (!r.ok) fail(m.wikiErr(r.status), 502);
    const hits = ((await r.json()).query || {}).search || [];
    if (!hits.length) continue;
    const sources = hits.map(h => ({ title: h.title, url: safe(`${base}/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`), snippet: strip(h.snippet) + "…" }));
    let answer = "";
    try {
      const sr = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(hits[0].title.replace(/ /g, "_"))}`, { headers: H });
      if (sr.ok) answer = (await sr.json()).extract || "";
    } catch (e) { /* 요약이 없어도 목록은 돌려줌 */ }
    return { lang, answer: answer || sources[0].snippet, sources };
  }
  return { answer: "", sources: [] };
}

/* ---------------- 인터넷 검색 (OpenAI Responses API의 web_search 도구) ---------------- */
async function webSearch(env, body, m) {
  if (!env.OPENAI_API_KEY) fail(m.noOpenAI);
  if (String(env.WEB_SEARCH || "").toLowerCase() === "off") fail(m.searchOff, 403);
  const query = String(body.query || "").trim().slice(0, 500);
  if (!query) fail(m.noQuery);
  const lang = body.lang === "en" ? "English" : "Korean (polite ~입니다/~합니다 style)";
  const model = env.OPENAI_SEARCH_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL;
  const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const r = await fetch(`${base}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      instructions: `Search the web for the user's query and answer in ${lang} in 3-6 short sentences, beginner-friendly, with key facts and dates. Use only what you found. Cite sources inline as Markdown links.`,
      input: query
    })
  });
  const j = await readOpenAI(r, m, model);
  let answer = "";
  const sources = [];
  const add = (url, title) => { if (url && !sources.some(x => x.url === url)) sources.push({ url, title: title || "" }); };
  for (const item of j.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text") {
          answer += c.text || "";
          for (const a of c.annotations || []) if (a.type === "url_citation") add(a.url, a.title);
        }
      }
    } else if (item.type === "web_search_call") {
      for (const src of (item.action && item.action.sources) || []) add(src.url, src.title);
    }
  }
  if (!answer && j.output_text) answer = j.output_text;
  return { query, answer: answer.trim(), sources: sources.slice(0, 8), model };
}

/* ---------------- Notion ---------------- */
const NOTION_API = "https://api.notion.com/v1";
async function notion(env, m, path, method = "GET", body) {
  if (!env.NOTION_TOKEN) fail(m.noNotion);
  const r = await fetch(NOTION_API + path, {
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) fail(m.notionNotFound, 404);
    fail(m.notionErr(j.message || r.status), r.status);
  }
  return j;
}
function toPageId(s, m) {
  const str = String(s || "");
  const uuid = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const hex = str.match(/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i);
  if (!hex) fail(m.badPageId);
  const h = hex[0];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const plain = rt => (rt || []).map(t => t.plain_text || "").join("");
function pageTitle(p) {
  if (p.object === "database") return plain(p.title);
  const props = p.properties || {};
  for (const k in props) if (props[k].type === "title") return plain(props[k].title);
  return "";
}

async function notionSearch(env, body, m) {
  const j = await notion(env, m, "/search", "POST", {
    query: String(body.query || ""),
    page_size: 10,
    sort: { direction: "descending", timestamp: "last_edited_time" }
  });
  return { results: j.results.map(p => ({ id: p.id, object: p.object, title: pageTitle(p), url: p.url, last_edited: p.last_edited_time })) };
}

function blockToText(b, m) {
  const t = b.type, v = b[t] || {};
  const txt = plain(v.rich_text);
  switch (t) {
    case "heading_1": return "# " + txt;
    case "heading_2": return "## " + txt;
    case "heading_3": return "### " + txt;
    case "bulleted_list_item": return "- " + txt;
    case "numbered_list_item": return "1. " + txt;
    case "to_do": return (v.checked ? "[x] " : "[ ] ") + txt;
    case "quote": return "> " + txt;
    case "code": return "```\n" + txt + "\n```";
    case "equation": return "$$ " + (v.expression || "") + " $$";
    case "divider": return "---";
    case "child_page": return "📄 " + (v.title || "");
    case "child_database": return "🗂️ " + (v.title || "");
    case "table": return m.table;
    case "table_row": return "| " + (v.cells || []).map(plain).join(" | ") + " |";
    case "image": return m.image;
    case "embed": case "file": case "pdf": case "video": case "bookmark": return m.attachment;
    default: return txt;
  }
}
async function notionRead(env, body, m) {
  const id = toPageId(body.page, m);
  const page = await notion(env, m, `/pages/${id}`);
  const lines = [];
  let cursor, rounds = 0;
  do {
    const j = await notion(env, m, `/blocks/${id}/children?page_size=100${cursor ? "&start_cursor=" + cursor : ""}`);
    for (const b of j.results) {
      lines.push(blockToText(b, m));
      // 표·토글·콜아웃 안쪽 내용도 한 단계만 읽기
      if (b.has_children && ["table", "toggle", "callout", "column_list", "column"].includes(b.type) && lines.length < 400) {
        const kids = await notion(env, m, `/blocks/${b.id}/children?page_size=100`);
        kids.results.forEach(k => lines.push("  " + blockToText(k, m)));
      }
    }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && ++rounds < 4);
  const text = lines.filter(l => l.trim()).join("\n");
  return { id, title: pageTitle(page), url: page.url, text: text.slice(0, 15000), truncated: text.length > 15000 || !!cursor };
}

/* 마크다운 → Notion 블록 */
const CODE_LANGS = ["javascript", "python", "html", "css", "json", "markdown", "bash", "java", "c", "c++", "typescript", "sql"];
function richText(text, base = {}) {
  const out = [];
  const push = (content, ann = {}, link) => {
    for (let i = 0; i < content.length; i += 1900) {
      out.push({ type: "text", text: { content: content.slice(i, i + 1900), link: link ? { url: link } : null }, annotations: { ...base, ...ann } });
    }
  };
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0, mt;
  while ((mt = re.exec(text))) {
    if (mt.index > last) push(text.slice(last, mt.index));
    const t = mt[0];
    if (t.startsWith("**")) push(t.slice(2, -2), { bold: true });
    else if (t.startsWith("`")) push(t.slice(1, -1), { code: true });
    else { const mm = t.match(/^\[([^\]]+)\]\((.+)\)$/); push(mm[1], {}, mm[2]); }
    last = re.lastIndex;
  }
  if (last < text.length) push(text.slice(last));
  return out.slice(0, 100);
}
function mdToBlocks(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  const block = (type, extra) => blocks.push({ object: "block", type, [type]: extra });
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = l.match(/^\s*```\s*([\w+#-]*)/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const lang = (fence[1] || "").toLowerCase().replace(/^js$/, "javascript").replace(/^py$/, "python").replace(/^md$/, "markdown");
      const code = buf.join("\n");
      const rt = [];
      for (let k = 0; k < code.length; k += 1900) rt.push({ type: "text", text: { content: code.slice(k, k + 1900) } });
      block("code", { rich_text: rt.length ? rt : [{ type: "text", text: { content: "" } }], language: CODE_LANGS.includes(lang) ? lang : "plain text" });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
        i++;
      }
      const width = Math.max(...rows.map(r => r.length));
      block("table", {
        table_width: width, has_column_header: true, has_row_header: false,
        children: rows.slice(0, 99).map(r => ({ object: "block", type: "table_row", table_row: { cells: Array.from({ length: width }, (_, k) => richText(r[k] || "")) } }))
      });
      continue;
    }
    let mt;
    if ((mt = l.match(/^(#{1,6})\s+(.*)/))) block(`heading_${Math.min(3, mt[1].length)}`, { rich_text: richText(mt[2]) });
    else if ((mt = l.match(/^\s*[-*•]\s+(.*)/))) block("bulleted_list_item", { rich_text: richText(mt[1]) });
    else if ((mt = l.match(/^\s*\d+[.)]\s+(.*)/))) block("numbered_list_item", { rich_text: richText(mt[1]) });
    else if ((mt = l.match(/^>\s?(.*)/))) block("quote", { rich_text: richText(mt[1]) });
    else if (/^\s*(---|\*\*\*)\s*$/.test(l)) block("divider", {});
    else if (l.trim()) block("paragraph", { rich_text: richText(l) });
    i++;
  }
  return blocks;
}
async function appendBlocks(env, m, id, blocks) {
  for (let i = 0; i < blocks.length; i += 100) {
    await notion(env, m, `/blocks/${id}/children`, "PATCH", { children: blocks.slice(i, i + 100) });
  }
}
async function notionCreate(env, body, m) {
  const parentRaw = body.parent || env.NOTION_PARENT_PAGE_ID;
  if (!parentRaw) fail(m.noParent);
  const parent = toPageId(parentRaw, m);
  const title = String(body.title || m.defaultTitle).slice(0, 200);
  const blocks = mdToBlocks(body.content);
  const page = await notion(env, m, "/pages", "POST", {
    parent: { page_id: parent },
    icon: { type: "emoji", emoji: "📊" },
    properties: { title: { title: [{ type: "text", text: { content: title } }] } },
    children: blocks.slice(0, 100)
  });
  if (blocks.length > 100) await appendBlocks(env, m, page.id, blocks.slice(100));
  return { id: page.id, url: page.url, title, blocks: blocks.length };
}
async function notionAppend(env, body, m) {
  const id = toPageId(body.page, m);
  const blocks = mdToBlocks(body.content);
  if (!blocks.length) fail(m.emptyAppend);
  await appendBlocks(env, m, id, blocks);
  const page = await notion(env, m, `/pages/${id}`);
  return { id, url: page.url, title: pageTitle(page), blocks: blocks.length };
}

/* ---------------- GitHub ---------------- */
async function github(env, m, path, method = "GET", body) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) fail(m.noGithub);
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "data-helper-worker",
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) fail(m.ghNotFound, 404);
    if (r.status === 401 || r.status === 403) fail(m.ghPerm, r.status);
    fail(m.ghErr(j.message || r.status), r.status);
  }
  return j;
}
function cleanPath(p) {
  return String(p || "").split("/").filter(s => s && s !== "." && s !== "..").map(encodeURIComponent).join("/");
}
const branchOf = env => env.GITHUB_BRANCH || "main";

async function githubList(env, body, m) {
  const p = cleanPath(body.path);
  const j = await github(env, m, `/contents/${p}?ref=${encodeURIComponent(branchOf(env))}`);
  const items = (Array.isArray(j) ? j : [j]).map(f => ({ name: f.name, path: f.path, type: f.type, size: f.type === "file" ? f.size : undefined }));
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { repo: env.GITHUB_REPO, path: body.path || "", items };
}
async function githubRead(env, body, m) {
  const p = cleanPath(body.path);
  if (!p) fail(m.needPath);
  const j = await github(env, m, `/contents/${p}?ref=${encodeURIComponent(branchOf(env))}`);
  if (Array.isArray(j)) fail(m.isFolder);
  if (j.type !== "file" || j.content == null || j.size > 1000000) fail(m.tooBig);
  const text = fromBase64(j.content);
  return { path: j.path, size: j.size, url: j.html_url, content: text.slice(0, 100000), truncated: text.length > 100000 };
}
async function githubWrite(env, body, m) {
  const p = cleanPath(body.path);
  if (!p) fail(m.needWritePath);
  if (body.content == null) fail(m.noContent);
  let sha;
  try {
    const cur = await github(env, m, `/contents/${p}?ref=${encodeURIComponent(branchOf(env))}`);
    if (!Array.isArray(cur)) sha = cur.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const j = await github(env, m, `/contents/${p}`, "PUT", {
    message: String(body.message || m.saveMsg(body.path)).slice(0, 200),
    content: toBase64(String(body.content)),
    branch: branchOf(env),
    ...(sha ? { sha } : {})
  });
  return { path: j.content.path, url: j.content.html_url, commit: j.commit.sha.slice(0, 7), created: !sha };
}
