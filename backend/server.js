import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8080);
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";
const API_ROOT = "https://api.notion.com/v1";
const START_DATE = "2026-10-19";
const TOTAL_DAYS = 21;
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || "";
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const APP_ACCESS_KEY = process.env.APP_ACCESS_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://code-nomad365.github.io";

function json(response, status, value, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin === ALLOWED_ORIGIN ? {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Vary": "Origin"
    } : {})
  });
  response.end(JSON.stringify(value));
}

function corsHeaders(origin) {
  if (!origin || origin !== ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function isAuthorized(request) {
  if (!APP_ACCESS_KEY) return false;
  const header = request.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(APP_ACCESS_KEY);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16384) throw Object.assign(new Error("請求內容太大"), { status: 413 });
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("JSON 格式錯誤"), { status: 400 });
  }
}

function ensureConfigured() {
  if (!NOTION_TOKEN || !DATA_SOURCE_ID) {
    throw Object.assign(new Error("Notion API 尚未完成設定"), { status: 503 });
  }
}

async function notion(path, options = {}) {
  ensureConfigured();
  const response = await fetch(API_ROOT + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Notion API 請求失敗");
    error.status = response.status === 401 || response.status === 403 ? 502 : response.status;
    throw error;
  }
  return body;
}

async function getAllPages() {
  const pages = [];
  let cursor;
  do {
    const result = await notion(`/data_sources/${encodeURIComponent(DATA_SOURCE_ID)}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
    });
    pages.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function pageTitle(page) {
  const titleProperty = page.properties?.["閱讀日"];
  return titleProperty?.title?.map(part => part.plain_text || "").join("") || "";
}

function getChallengeDate(index) {
  const date = new Date(`${START_DATE}T12:00:00+08:00`);
  date.setDate(date.getDate() + index);
  return date.toISOString().slice(0, 10);
}

function buildPageMap(pages) {
  const map = new Map();
  for (const page of pages) {
    const match = pageTitle(page).match(/^Day\s*(\d{1,2})$/i);
    if (!match) continue;
    const day = Number(match[1]);
    if (day >= 1 && day <= TOTAL_DAYS) map.set(day, page);
  }
  if (map.size !== TOTAL_DAYS) {
    throw Object.assign(new Error(`Notion 資料庫需要有 Day 01–Day 21，共 21 筆記錄；目前找到 ${map.size} 筆`), { status: 502 });
  }
  return map;
}

async function updatePage(pageId, completed) {
  return notion(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        "完成閱讀": { checkbox: completed },
        ...(completed ? { "實際分鐘": { number: 15 } } : {})
      }
    })
  });
}

async function handleApi(request, response, url, origin) {
  if (!isAuthorized(request)) return json(response, 401, { error: "未授權，請輸入同步代碼" }, origin);
  if (url.pathname === "/api/checkins" && request.method === "GET") {
    const pages = buildPageMap(await getAllPages());
    const completedDates = [];
    for (let day = 1; day <= TOTAL_DAYS; day++) {
      const page = pages.get(day);
      if (page.properties?.["完成閱讀"]?.checkbox) completedDates.push(getChallengeDate(day - 1));
    }
    return json(response, 200, { completedDates }, origin);
  }
  if (url.pathname === "/api/checkins" && request.method === "PUT") {
    const body = await readJson(request);
    if (!Array.isArray(body.completedDates)) {
      return json(response, 400, { error: "completedDates 必須是日期陣列" }, origin);
    }
    const validDates = new Set(Array.from({ length: TOTAL_DAYS }, (_, index) => getChallengeDate(index)));
    const completed = new Set(body.completedDates);
    if (completed.size !== body.completedDates.length || [...completed].some(date => !validDates.has(date))) {
      return json(response, 400, { error: "備份包含重複或不在挑戰期間的日期" }, origin);
    }
    const pages = buildPageMap(await getAllPages());
    for (let day = 1; day <= TOTAL_DAYS; day++) {
      const date = getChallengeDate(day - 1);
      await updatePage(pages.get(day).id, completed.has(date));
      if (day < TOTAL_DAYS) await new Promise(resolve => setTimeout(resolve, 350));
    }
    return json(response, 200, { completedDates: [...completed].sort() }, origin);
  }
  const match = url.pathname.match(/^\/api\/checkins\/(\d{1,2})$/);
  if (match && request.method === "PUT") {
    const day = Number(match[1]);
    if (day < 1 || day > TOTAL_DAYS) return json(response, 400, { error: "Day 必須介於 1 到 21" }, origin);
    const body = await readJson(request);
    if (typeof body.completed !== "boolean") return json(response, 400, { error: "completed 必須是布林值" }, origin);
    const pages = buildPageMap(await getAllPages());
    await updatePage(pages.get(day).id, body.completed);
    return json(response, 200, { day, completed: body.completed }, origin);
  }
  return json(response, 404, { error: "找不到 API 路徑" }, origin);
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") {
    response.writeHead(origin === ALLOWED_ORIGIN ? 204 : 403, corsHeaders(origin));
    return response.end();
  }
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, {
      status: "ok",
      notionConfigured: Boolean(NOTION_TOKEN && DATA_SOURCE_ID),
      appAccessConfigured: Boolean(APP_ACCESS_KEY)
    }, origin);
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/api/")) return json(response, 404, { error: "Not found" }, origin);
  if (origin && origin !== ALLOWED_ORIGIN) return json(response, 403, { error: "不允許的來源" }, origin);
  try {
    await handleApi(request, response, url, origin);
  } catch (error) {
    const status = Number(error.status) || 500;
    json(response, status, { error: error.message || "伺服器發生錯誤" }, origin);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Reading tracker API listening on ${PORT}`);
});
