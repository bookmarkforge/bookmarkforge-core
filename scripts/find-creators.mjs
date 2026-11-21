#!/usr/bin/env node
/**
 * find-creators.mjs — discover YouTube creators in the PKM / productivity /
 * AI-tools niche for BookmarkForge outreach.
 *
 * Uses the official YouTube Data API v3 (search + channels + videos). No
 * scraping, no dependencies — global fetch only.
 *
 * Auth: set YOUTUBE_API_KEY to a Google Cloud API key with the "YouTube Data
 * API v3" enabled (https://console.cloud.google.com/apis/credentials).
 * Default quota is 10,000 units/day; this script prints an estimate before
 * spending anything and refuses to start above --max-units (default 9,000).
 *
 * What it does per keyword:
 *   1. search.list  (type=video, order=viewCount)  — 100 units each
 *   2. channels.list (statistics + snippet)        — 1 unit per 50 channels
 *   3. videos.list   (statistics for top video)    — 1 unit per 50 videos
 *
 * Output: a CSV (stdout or --out) with one row per channel in the
 * micro-influencer band, plus a ready-to-share UTM-tagged app link so each
 * creator gets a measurable URL. Business emails are extracted from channel
 * descriptions when creators publish one.
 *
 * Usage:
 *   YOUTUBE_API_KEY=... node scripts/find-creators.mjs [options]
 *
 * Options:
 *   --keywords <list>   comma-separated queries   (default: built-in EN+ES set)
 *   --min-subs <n>      minimum subscribers       (default: 1000)
 *   --max-subs <n>      maximum subscribers       (default: 500000)
 *   --per-keyword <n>   videos scanned per query  (default: 25, max 50)
 *   --max-units <n>     quota ceiling             (default: 9000)
 *   --out <file>        write CSV to file         (default: stdout)
 *   --json <file>       also write full JSON data (default: none)
 *   --sort <field>      subs | views | videos     (default: subs)
 *   -h, --help          show this help
 *
 * Notes:
 *   - TikTok and Instagram have no public search API; this script covers
 *     YouTube only. For those platforms use Collabstr/Manual discovery.
 *   - The app does not capture UTM parameters (privacy-first, no telemetry),
 *     so per-creator conversion measurement relies on the host's access
 *     logs / Vercel analytics or on issuing per-creator license keys.
 */

import { writeFileSync } from "node:fs";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const APP_URL = "https://www.bookmarkforgeapp.com/app";

const DEFAULT_KEYWORDS = [
  "second brain app",
  "PKM app",
  "personal knowledge management",
  "bookmark manager",
  "Readwise alternative",
  "Omnivore alternative",
  "Raindrop.io alternative",
  "web clipper",
  "note taking AI",
  "AI productivity tools",
  "knowledge management app",
  "obsidian bookmarks",
  "segundo cerebro app",
  "gestion de marcadores",
  "productividad con IA",
  "apps para estudiar",
];

const SEARCH_UNITS = 100;
const CHANNELS_UNITS_PER_CALL = 1;
const VIDEOS_UNITS_PER_CALL = 1;
const CHANNELS_PER_CALL = 50;
const VIDEOS_PER_CALL = 50;
const SLEEP_MS = 150;

function parseArgs(argv) {
  const opts = {
    keywords: DEFAULT_KEYWORDS,
    minSubs: 1_000,
    maxSubs: 500_000,
    perKeyword: 25,
    maxUnits: 9_000,
    out: null,
    json: null,
    sort: "subs",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--keywords":
        opts.keywords = next()
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        break;
      case "--min-subs":
        opts.minSubs = Number(next());
        break;
      case "--max-subs":
        opts.maxSubs = Number(next());
        break;
      case "--per-keyword":
        opts.perKeyword = Math.min(50, Number(next()));
        break;
      case "--max-units":
        opts.maxUnits = Number(next());
        break;
      case "--out":
        opts.out = next();
        break;
      case "--json":
        opts.json = next();
        break;
      case "--sort":
        opts.sort = next();
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }
  for (const [key, val] of [
    ["min-subs", opts.minSubs],
    ["max-subs", opts.maxSubs],
    ["per-keyword", opts.perKeyword],
    ["max-units", opts.maxUnits],
  ]) {
    if (!Number.isFinite(val) || val < 0) throw new Error(`invalid --${key}`);
  }
  if (!["subs", "views", "videos"].includes(opts.sort)) {
    throw new Error("--sort must be subs | views | videos");
  }
  if (opts.minSubs > opts.maxSubs) {
    throw new Error("--min-subs cannot exceed --max-subs");
  }
  if (opts.keywords.length === 0) throw new Error("--keywords produced an empty list");
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function yt(path, params, apiKey) {
  const url = new URL(`${API_BASE}/${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? `HTTP ${res.status}`;
    const err = new Error(`YouTube API ${path} failed: ${reason}`);
    err.reason = reason;
    throw err;
  }
  return body;
}

function extractEmail(description) {
  if (!description) return "";
  const match = description.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : "";
}

function utmLink(handle) {
  const content = (handle || "unknown").replace(/^@/, "");
  const url = new URL(APP_URL);
  url.searchParams.set("utm_source", "youtube");
  url.searchParams.set("utm_medium", "creator");
  url.searchParams.set("utm_campaign", "creator-outreach");
  url.searchParams.set("utm_content", content);
  return url.toString();
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSyncHelp());
    return;
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error(
      "YOUTUBE_API_KEY is not set. Create a key at https://console.cloud.google.com/apis/credentials " +
        "with the YouTube Data API v3 enabled, then run: YOUTUBE_API_KEY=... node scripts/find-creators.mjs",
    );
    process.exit(2);
  }

  // Quota estimate: searches dominate; channel/video lookups are batched.
  const estKeywords = opts.keywords.length;
  const estChannelCalls = Math.ceil((estKeywords * opts.perKeyword) / CHANNELS_PER_CALL);
  const estUnits =
    estKeywords * SEARCH_UNITS +
    estChannelCalls * (CHANNELS_UNITS_PER_CALL + VIDEOS_UNITS_PER_CALL) * 2;
  if (estUnits > opts.maxUnits) {
    console.error(
      `Estimated quota ${estUnits} units exceeds --max-units ${opts.maxUnits}. ` +
        `Reduce --keywords or --per-keyword.`,
    );
    process.exit(2);
  }
  console.error(
    `[find-creators] ${opts.keywords.length} keyword(s), ~${estUnits} quota units ` +
      `(daily default: 10,000). Searching...`,
  );

  // 1) Collect candidate videos per keyword.
  const byChannel = new Map(); // channelId -> { channelId, keywords:Set, videos:Map<videoId, snippet> }
  for (const keyword of opts.keywords) {
    const data = await yt(
      "search",
      {
        part: "snippet",
        q: keyword,
        type: "video",
        order: "viewCount",
        videoDuration: "medium",
        maxResults: opts.perKeyword,
        safeSearch: "moderate",
      },
      apiKey,
    );
    for (const item of data.items ?? []) {
      const chId = item.snippet?.channelId;
      const vId = item.snippet?.videoId;
      if (!chId || !vId) continue;
      if (!byChannel.has(chId)) {
        byChannel.set(chId, { channelId: chId, keywords: new Set(), videos: new Map() });
      }
      const entry = byChannel.get(chId);
      entry.keywords.add(keyword);
      if (!entry.videos.has(vId)) entry.videos.set(vId, item.snippet);
    }
    await sleep(SLEEP_MS);
  }

  const channelIds = [...byChannel.keys()];
  console.error(`[find-creators] ${channelIds.length} unique channel(s) found; fetching stats...`);

  // 2) Channel statistics, batched 50 per call.
  const channels = new Map();
  for (let i = 0; i < channelIds.length; i += CHANNELS_PER_CALL) {
    const batch = channelIds.slice(i, i + CHANNELS_PER_CALL);
    const data = await yt(
      "channels",
      { part: "snippet,statistics", id: batch.join(","), maxResults: CHANNELS_PER_CALL },
      apiKey,
    );
    for (const ch of data.items ?? []) {
      channels.set(ch.id, ch);
    }
    await sleep(SLEEP_MS);
  }

  // 3) Video statistics for the top-ranked video of each channel.
  const videoIds = [];
  const videoByChannel = new Map();
  for (const [chId, entry] of byChannel) {
    const first = [...entry.videos.keys()][0];
    if (first) {
      videoIds.push(first);
      videoByChannel.set(chId, first);
    }
  }
  const videoStats = new Map();
  for (let i = 0; i < videoIds.length; i += VIDEOS_PER_CALL) {
    const batch = videoIds.slice(i, i + VIDEOS_PER_CALL);
    const data = await yt(
      "videos",
      { part: "statistics", id: batch.join(","), maxResults: VIDEOS_PER_CALL },
      apiKey,
    );
    for (const v of data.items ?? []) videoStats.set(v.id, v.statistics);
    await sleep(SLEEP_MS);
  }

  // 4) Assemble rows, filter to the micro band.
  const rows = [];
  for (const [chId, entry] of byChannel) {
    const ch = channels.get(chId);
    if (!ch) continue;
    const subs = Number(ch.statistics?.subscriberCount ?? 0);
    if (subs < opts.minSubs || subs > opts.maxSubs) continue;

    const handle = ch.snippet?.customUrl ?? "";
    const topVideoId = videoByChannel.get(chId);
    const topSnippet = topVideoId ? entry.videos.get(topVideoId) : null;
    const topStats = topVideoId ? videoStats.get(topVideoId) : null;

    rows.push({
      channel: ch.snippet?.title ?? "",
      handle: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${chId}`,
      channelId: chId,
      subscribers: subs,
      totalViews: Number(ch.statistics?.viewCount ?? 0),
      videoCount: Number(ch.statistics?.videoCount ?? 0),
      joined: ch.snippet?.publishedAt?.slice(0, 10) ?? "",
      keywords: [...entry.keywords].join(" | "),
      topVideoTitle: topSnippet?.title ?? "",
      topVideoUrl: topVideoId ? `https://www.youtube.com/watch?v=${topVideoId}` : "",
      topVideoViews: Number(topStats?.viewCount ?? 0),
      topVideoLikes: Number(topStats?.likeCount ?? 0),
      email: extractEmail(ch.snippet?.description),
      utmLink: utmLink(handle || chId),
    });
  }

  const sortKey = { subs: "subscribers", views: "totalViews", videos: "videoCount" }[opts.sort];
  rows.sort((a, b) => b[sortKey] - a[sortKey]);

  const header = [
    "channel",
    "handle",
    "channelId",
    "subscribers",
    "totalViews",
    "videoCount",
    "joined",
    "keywords",
    "topVideoTitle",
    "topVideoUrl",
    "topVideoViews",
    "topVideoLikes",
    "email",
    "utmLink",
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")),
  ].join("\n");

  if (opts.out) {
    writeFileSync(opts.out, `${csv}\n`, "utf8");
    console.error(`[find-creators] wrote ${rows.length} row(s) to ${opts.out}`);
  } else {
    console.log(csv);
  }

  if (opts.json) {
    writeFileSync(opts.json, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.error(`[find-creators] wrote JSON to ${opts.json}`);
  }

  console.error(
    `[find-creators] done: ${rows.length} creator(s) in [${opts.minSubs}, ${opts.maxSubs}] subscribers.`,
  );
}

function readFileSyncHelp() {
  // Keep --help self-contained: print the usage block from the header comment.
  return `find-creators.mjs — discover YouTube creators (PKM/productivity/AI niche)

Auth: YOUTUBE_API_KEY env var (YouTube Data API v3 enabled).

Options:
  --keywords <list>   comma-separated queries   (default: 16 built-in EN+ES)
  --min-subs <n>      minimum subscribers       (default: 1000)
  --max-subs <n>      maximum subscribers       (default: 500000)
  --per-keyword <n>   videos scanned per query  (default: 25, max 50)
  --max-units <n>     quota ceiling             (default: 9000)
  --out <file>        write CSV to file         (default: stdout)
  --json <file>       also write full JSON data
  --sort <field>      subs | views | videos     (default: subs)
  -h, --help          show this help

Example:
  YOUTUBE_API_KEY=... node scripts/find-creators.mjs --out creators.csv --json creators.json
`;
}

main().catch((err) => {
  if (err?.reason === "quotaExceeded" || /quota/i.test(err?.message ?? "")) {
    console.error(
      "YouTube API quota exceeded. The script already estimated usage; " +
        "wait for the daily reset or request a quota increase in Google Cloud.",
    );
  } else {
    console.error(`[find-creators] ${err?.message ?? err}`);
  }
  process.exit(1);
});
