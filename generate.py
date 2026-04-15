#!/usr/bin/env python3
"""
Morning Edition — configurable daily magazine generator.
Supports multiple sources (HN, Reddit, RSS), rotating color themes,
OG image extraction, and LLM-powered Russian summaries via Z.ai.
"""

import json
import os
import re
import sys
import ssl
import hashlib
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser

# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------
CONFIG_PATH = os.environ.get("CONFIG_PATH", "config.json")
with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
    CFG = json.load(_f)

TZ = timezone(timedelta(hours=CFG.get("timezone_offset", -3)))
TODAY = datetime.now(TZ).strftime("%Y-%m-%d")
OUT_DIR = os.environ.get("OUT_DIR", "magazines")
FILE_PREFIX = os.environ.get("FILE_PREFIX", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-2.5-flash")
STORIES_COUNT = CFG.get("stories_count", 10)

# SSL context for fetching (some sites need it)
SSL_CTX = ssl.create_default_context()


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------
def fetch_url(url: str, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": "MorningEdition/2.0 (github.com/igortomko/dailynews)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return r.read()


def fetch_json(url: str) -> dict | list:
    return json.loads(fetch_url(url))


def escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ---------------------------------------------------------------------------
# OG Image extraction
# ---------------------------------------------------------------------------
class OGParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.og_image = ""

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        d = dict(attrs)
        if d.get("property") in ("og:image", "twitter:image"):
            self.og_image = d.get("content", "")
        elif d.get("name") in ("og:image", "twitter:image"):
            self.og_image = d.get("content", "")


def fetch_og_image(url: str) -> str:
    """Try to extract OG image from a URL. Returns empty string on failure."""
    if not url or "news.ycombinator.com" in url:
        return ""
    try:
        raw = fetch_url(url, timeout=8)
        # Only parse the head section
        text = raw[:20000].decode("utf-8", errors="ignore")
        parser = OGParser()
        parser.feed(text)
        img = parser.og_image
        if img and img.startswith("http") and not img.endswith(".svg"):
            return img
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# SOURCE: Hacker News
# ---------------------------------------------------------------------------
HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{}.json"


def fetch_hn(source_cfg: dict) -> list[dict]:
    n = source_cfg.get("fetch_count", 60)
    ids = fetch_json(HN_TOP)[:n]
    stories = []
    for sid in ids:
        try:
            item = fetch_json(HN_ITEM.format(sid))
            if item and item.get("type") == "story" and item.get("title"):
                stories.append({
                    "title": item["title"],
                    "url": item.get("url", ""),
                    "score": item.get("score", 0),
                    "comments": item.get("descendants", 0),
                    "comments_url": f"https://news.ycombinator.com/item?id={item['id']}",
                    "source": "Hacker News",
                    "_hn_kids": item.get("kids", [])[:3],
                    "_hn_id": item["id"],
                })
        except Exception:
            continue
    return stories


def fetch_hn_comments(story: dict) -> str:
    kids = story.get("_hn_kids", [])
    texts = []
    for kid_id in kids:
        try:
            comment = fetch_json(HN_ITEM.format(kid_id))
            if comment and comment.get("text"):
                raw = re.sub(r'<[^>]+>', ' ', comment["text"]).strip()[:300]
                if raw:
                    texts.append(raw)
        except Exception:
            continue
    return " | ".join(texts)


# ---------------------------------------------------------------------------
# SOURCE: Reddit (via RSS — JSON API blocks GitHub Actions IPs)
# ---------------------------------------------------------------------------
REDDIT_RSS = "https://www.reddit.com/r/{}/.rss?limit=25"


def fetch_reddit(source_cfg: dict) -> list[dict]:
    subs = source_cfg.get("subreddits", [])
    stories = []
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for sub in subs:
        try:
            req = urllib.request.Request(REDDIT_RSS.format(sub), headers={
                "User-Agent": "SessioHealthBot/1.0 (github.com/igortomko/dailynews)",
                "Accept": "application/rss+xml, application/atom+xml, application/xml",
            })
            raw = urllib.request.urlopen(req, timeout=15, context=SSL_CTX).read()
            root = ET.fromstring(raw)
            entries = root.findall(".//atom:entry", ns)
            for entry in entries[:10]:
                title = entry.findtext("atom:title", "", ns) or ""
                link_el = entry.find("atom:link", ns)
                link = link_el.get("href", "") if link_el is not None else ""
                # Content often has the actual URL
                content = entry.findtext("atom:content", "", ns) or ""
                # Extract external link from content if present
                ext_match = re.search(r'href="(https?://(?!www\.reddit\.com)[^"]+)"', content)
                ext_url = ext_match.group(1) if ext_match else link
                stories.append({
                    "title": title,
                    "url": ext_url,
                    "score": 0,
                    "comments": 0,
                    "comments_url": link,
                    "source": f"r/{sub}",
                })
            print(f"    r/{sub}: {len(entries)} entries")
        except Exception as e:
            print(f"  Reddit r/{sub} error: {e}", file=sys.stderr)
    return stories


# ---------------------------------------------------------------------------
# SOURCE: RSS
# ---------------------------------------------------------------------------
def fetch_rss(source_cfg: dict) -> list[dict]:
    feeds = source_cfg.get("feeds", [])
    stories = []
    for feed_cfg in feeds:
        try:
            raw = fetch_url(feed_cfg["url"], timeout=10)
            root = ET.fromstring(raw)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            # Try Atom format
            entries = root.findall(".//atom:entry", ns)
            if entries:
                for entry in entries[:5]:
                    title = entry.findtext("atom:title", "", ns)
                    link_el = entry.find("atom:link", ns)
                    link = link_el.get("href", "") if link_el is not None else ""
                    stories.append({
                        "title": title,
                        "url": link,
                        "score": 0,
                        "comments": 0,
                        "comments_url": link,
                        "source": feed_cfg.get("label", "RSS"),
                    })
            else:
                # Try RSS 2.0
                for item in root.findall(".//item")[:5]:
                    stories.append({
                        "title": item.findtext("title", ""),
                        "url": item.findtext("link", ""),
                        "score": 0,
                        "comments": 0,
                        "comments_url": item.findtext("comments", item.findtext("link", "")),
                        "source": feed_cfg.get("label", "RSS"),
                    })
        except Exception as e:
            print(f"  RSS {feed_cfg.get('label', '?')} error: {e}", file=sys.stderr)
    return stories


# ---------------------------------------------------------------------------
# Fetch all sources
# ---------------------------------------------------------------------------
SOURCE_FETCHERS = {
    "hackernews": fetch_hn,
    "reddit": fetch_reddit,
    "rss": fetch_rss,
}


def fetch_all_sources() -> list[dict]:
    all_stories = []
    for source in CFG.get("sources", []):
        if not source.get("enabled", False):
            continue
        fetcher = SOURCE_FETCHERS.get(source["type"])
        if not fetcher:
            print(f"  Unknown source type: {source['type']}", file=sys.stderr)
            continue
        print(f"  Fetching from {source.get('label', source['type'])}...")
        stories = fetcher(source)
        print(f"    Got {len(stories)} stories")
        all_stories.extend(stories)
    return all_stories


# ---------------------------------------------------------------------------
# Scoring & curation
# ---------------------------------------------------------------------------
def score_story(story: dict) -> tuple[int, float]:
    """Returns (keyword_hits, total_score). Stories with 0 hits are irrelevant."""
    text = f"{story.get('title', '')} {story.get('url', '')}".lower()
    kw_hits = 0
    for kw in CFG.get("interests", []):
        if kw.lower() in text:
            kw_hits += 1

    score = kw_hits * 60 + story.get("score", 0) * 0.2 + min(story.get("comments", 0), 200) * 0.1
    return kw_hits, score


def applies_to_me(title: str) -> bool:
    t = title.lower()
    return any(k in t for k in CFG.get("direct_relevance_keywords", []))


def curate(stories: list[dict], n: int = 10) -> list[dict]:
    # Score all stories
    for s in stories:
        kw_hits, total = score_story(s)
        s["_kw_hits"] = kw_hits
        s["_score"] = total

    # Only keep stories with at least 1 keyword match
    relevant = [s for s in stories if s["_kw_hits"] > 0]
    print(f"  Relevant stories (≥1 keyword): {len(relevant)} / {len(stories)}")

    if len(relevant) < n:
        # Fallback: fill remaining slots with highest-scored generic stories
        generic = sorted(
            [s for s in stories if s["_kw_hits"] == 0],
            key=lambda s: s["_score"],
            reverse=True,
        )
        relevant.extend(generic[: n - len(relevant)])

    scored = sorted(relevant, key=lambda s: s["_score"], reverse=True)
    top = scored[:n]
    for s in top:
        s["_applies"] = applies_to_me(s.get("title", ""))
    return top


# ---------------------------------------------------------------------------
# OG Image enrichment
# ---------------------------------------------------------------------------
def enrich_images(stories: list[dict]) -> list[dict]:
    print("  Fetching OG images...")
    for s in stories:
        if not s.get("_og_image"):
            s["_og_image"] = fetch_og_image(s.get("url", ""))
        if s.get("_og_image"):
            print(f"    ✓ {s['title'][:40]}...")
    return stories


# ---------------------------------------------------------------------------
# Comment context
# ---------------------------------------------------------------------------
def enrich_comments(stories: list[dict]) -> list[dict]:
    print("  Fetching comments for context...")
    for s in stories:
        if s.get("_hn_kids"):
            s["_comments_text"] = fetch_hn_comments(s)
        else:
            s.setdefault("_comments_text", "")
    return stories


# ---------------------------------------------------------------------------
# LLM summary + Russian translation
# ---------------------------------------------------------------------------
def _guess_category(title: str) -> str:
    t = title.lower()
    cats = [
        ("Voice AI", ["speech", "voice", "transcri", "whisper", "eleven labs", "deepgram", "tts", "stt"]),
        ("LLM", ["llm", "gpt", "claude", "anthropic", "openai", "gemini", "llama", "mistral", "fine-tun", "rlhf", "reasoning"]),
        ("Vibe Coding", ["vibe cod", "ai cod", "cursor", "copilot", "claude code", "replit", "bolt"]),
        ("AI Design", ["ai design", "figma ai", "generative ui", "design system"]),
        ("Crypto", ["crypto", "defi", "bitcoin", "ethereum", "solana", "web3", "token", "stablecoin", "onchain"]),
        ("Indie", ["indie", "solo founder", "bootstrap", "micro saas", "side project", "launch", "product hunt", "ship"]),
        ("ASO", ["aso", "app store optim", "mobile growth", "app rank"]),
        ("Behavioral", ["behavioral", "nudge", "habit", "gamification", "cognitive bias", "persuasion"]),
        ("Biohacking", ["biohack", "longev", "aging", "lifespan", "healthspan", "rapamycin", "nad+", "glp-1", "peptide", "fasting", "vo2max", "zone 2", "attia", "bryan johnson", "sleep"]),
        ("Nutrition", ["nutrition", "protein", "diet", "supplement", "gut ", "microbiome"]),
        ("Dev Tools", ["dev tool", "github", "sdk", "api ", "framework"]),
        ("Privacy", ["privacy", "encrypt", "surveillance", "security"]),
    ]
    for cat, keywords in cats:
        if any(k in t for k in keywords):
            return cat
    return "Tech"


def enrich_llm(stories: list[dict]) -> list[dict]:
    if not LLM_API_KEY:
        print("  No LLM_API_KEY — using comment excerpts (English only)")
        for s in stories:
            s["_title_ru"] = ""
            s["_summary"] = s.get("_comments_text", "")[:200]
            s["_category"] = _guess_category(s.get("title", ""))
        return stories

    reader_ctx = CFG.get("reader_context", "")
    stories_block = "\n\n".join(
        f"---\n{i+1}. TITLE: {s['title']}\n"
        f"URL: {s.get('url', 'N/A')}\n"
        f"SOURCE: {s.get('source', '?')}\n"
        f"POINTS: {s.get('score', 0)} | COMMENTS: {s.get('comments', 0)}\n"
        f"TOP COMMENTS: {s.get('_comments_text', 'N/A')[:400]}"
        for i, s in enumerate(stories)
    )
    prompt = f"""{reader_ctx}

Ниже {len(stories)} историй из разных источников с контекстом из комментариев. Для каждой дай:

1. "title_ru" — перевод заголовка на русский (живой, не дословный, как в хорошем журнале)
2. "summary" — саммари на русский, 2-3 предложения. Объясни суть: что произошло, почему это важно, что обсуждают в комментариях. Тон — как в Медузе или The Bell, информативно и с характером.
3. "category" — одна из: Voice AI, LLM, Vibe Coding, AI Design, Crypto, Indie, ASO, Behavioral, Biohacking, Nutrition, Dev Tools, Privacy, Tech
4. "applies" — true если история напрямую связана с контекстом читателя выше

Истории:
{stories_block}

Ответь ТОЛЬКО валидным JSON массивом:
[{{"index": 1, "title_ru": "...", "summary": "...", "category": "...", "applies": true/false}}, ...]
Без markdown, без комментариев, только JSON."""

    url = f"{LLM_BASE_URL.rstrip('/')}/chat/completions"
    body = json.dumps({
        "model": LLM_MODEL,
        "max_tokens": 16000,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LLM_API_KEY}",
    })
    try:
        print(f"  Calling {LLM_BASE_URL} ({LLM_MODEL})...")
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read())
        text = resp["choices"][0]["message"]["content"] or ""
        # Strip markdown code blocks if present
        text = re.sub(r'```(?:json)?\s*', '', text).strip()
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            items = json.loads(match.group())
            applied = 0
            for item in items:
                idx = item["index"] - 1
                if 0 <= idx < len(stories):
                    stories[idx]["_title_ru"] = item.get("title_ru", "")
                    stories[idx]["_summary"] = item.get("summary", "")
                    stories[idx]["_category"] = item.get("category", "Tech")
                    if item.get("applies"):
                        stories[idx]["_applies"] = True
                    applied += 1
            print(f"  LLM enrichment done ({applied}/{len(stories)} stories)")
        else:
            print(f"  LLM returned no parseable JSON. Response: {text[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"  LLM API error: {e}", file=sys.stderr)
        for s in stories:
            s.setdefault("_title_ru", "")
            s.setdefault("_summary", s.get("_comments_text", "")[:200])
            s.setdefault("_category", _guess_category(s.get("title", "")))

    for s in stories:
        s.setdefault("_title_ru", "")
        s.setdefault("_summary", "")
        s.setdefault("_category", _guess_category(s.get("title", "")))
    return stories


# ---------------------------------------------------------------------------
# Theme selection (rotates daily by date hash)
# ---------------------------------------------------------------------------
def get_theme(date: str) -> dict:
    themes = CFG.get("theme_sets", {})
    theme_name = os.environ.get("THEME", "")
    if theme_name and theme_name in themes:
        return themes[theme_name]
    # Rotate by day
    names = sorted(themes.keys())
    if not names:
        return themes.get("default", {})
    day_hash = int(hashlib.md5(date.encode()).hexdigest()[:8], 16)
    pick = names[day_hash % len(names)]
    print(f"  Theme of the day: {pick}")
    return themes[pick]


# ---------------------------------------------------------------------------
# HTML Magazine Renderer
# ---------------------------------------------------------------------------
LAYOUTS = [
    "hero", "midnight", "rose-stamp", "terminal", "academic",
    "big-stat", "warm-sand", "deep-purple", "newsprint", "closer",
]


def render_spread(idx: int, story: dict, style: dict) -> str:
    num = f"{idx + 1:02d}"
    title = escape(story.get("title", "Untitled"))
    title_ru = escape(story.get("_title_ru", ""))
    url = story.get("url") or story.get("comments_url", "#")
    comments_url = story.get("comments_url", "#")
    summary = escape(story.get("_summary", ""))
    category = escape(story.get("_category", "Tech"))
    points = story.get("score", 0)
    comments = story.get("comments", 0)
    applies = story.get("_applies", False)
    source = escape(story.get("source", ""))
    og_image = story.get("_og_image", "")
    domain = ""
    if story.get("url"):
        try:
            domain = story["url"].split("//")[1].split("/")[0].replace("www.", "")
        except Exception:
            domain = ""

    display_title = title_ru if title_ru else title

    applies_badge = ""
    if applies:
        applies_badge = f"""
        <div style="display:inline-block;background:{style['accent']};
            color:{'#fff' if style['layout'] not in ('terminal',) else '#000'};
            padding:6px 16px;font-family:'Inter',sans-serif;font-size:0.75rem;
            font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
            margin-bottom:1.5rem;border-radius:2px;">⚡ Прямо про тебя</div><br>"""

    en_subtitle = f"""
    <div style="font-family:'Inter',sans-serif;font-size:clamp(0.85rem,1.2vw,1rem);
        font-weight:500;color:{style['muted']};margin-top:1rem;max-width:750px;">
        {title}</div>""" if title_ru else ""

    meta_html = f"""
    <div style="font-family:'Inter',sans-serif;font-size:0.9rem;color:{style['muted']};
        margin-top:1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;">
        <span style="font-weight:600;color:{style['accent']};">{category}</span>
        <span>{source}</span>
        {'<span>' + str(points) + ' pts</span>' if points else ''}
        <span><a href="{comments_url}" style="color:{style['muted']};text-decoration:underline;"
            target="_blank">{comments} comments</a></span>
        {'<span>' + escape(domain) + '</span>' if domain else ''}
    </div>"""

    summary_html = f"""
    <p style="font-family:'Inter',sans-serif;font-size:1.15rem;line-height:1.75;
        color:{style['text']};opacity:0.85;max-width:700px;margin-top:1.5rem;">
        {summary}</p>""" if summary else ""

    # Image block — different treatments based on layout
    img_html = ""
    if og_image:
        is_dark = style["layout"] in ("midnight", "terminal", "big-stat", "deep-purple", "closer")
        if style["layout"] in ("hero", "midnight", "closer"):
            # Full-width background image treatment
            img_html = f"""
            <div style="position:absolute;inset:0;z-index:0;overflow:hidden;">
                <img src="{escape(og_image)}" alt="" style="width:100%;height:100%;
                    object-fit:cover;opacity:0.15;filter:{'brightness(0.4)' if is_dark else 'brightness(0.9) saturate(0.7)'};"
                    loading="lazy" onerror="this.style.display='none'">
            </div>"""
        elif style["layout"] in ("rose-stamp", "warm-sand", "newsprint"):
            # Side/inline image
            img_html = f"""
            <div style="margin-top:2rem;max-width:600px;border-radius:4px;overflow:hidden;">
                <img src="{escape(og_image)}" alt="" style="width:100%;height:auto;
                    max-height:320px;object-fit:cover;display:block;"
                    loading="lazy" onerror="this.parentElement.style.display='none'">
            </div>"""
        elif style["layout"] in ("academic", "deep-purple"):
            # Elegant offset image
            img_html = f"""
            <div style="position:absolute;right:6vw;bottom:4rem;width:clamp(200px,25vw,380px);
                opacity:0.8;border-radius:4px;overflow:hidden;z-index:0;">
                <img src="{escape(og_image)}" alt="" style="width:100%;height:auto;
                    display:block;filter:{'brightness(0.8)' if is_dark else 'none'};"
                    loading="lazy" onerror="this.parentElement.style.display='none'">
            </div>"""
        else:
            # Compact image for terminal, big-stat
            img_html = f"""
            <div style="margin-top:1.5rem;max-width:500px;border-radius:2px;overflow:hidden;">
                <img src="{escape(og_image)}" alt="" style="width:100%;height:auto;
                    max-height:250px;object-fit:cover;display:block;
                    {'filter:brightness(0.9) contrast(1.1) saturate(0.8);' if style['layout'] == 'terminal' else ''}"
                    loading="lazy" onerror="this.parentElement.style.display='none'">
            </div>"""

    # Content zone (z-index:1 for layouts with bg image)
    z1 = 'position:relative;z-index:1;' if og_image and style["layout"] in ("hero", "midnight", "closer") else ""

    # Common heading styles per layout
    layout = style["layout"]

    if layout == "hero":
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;flex-direction:column;justify-content:center;padding:4rem 6vw;
            position:relative;overflow:hidden;">
            {img_html}
            <div style="{z1}">
                <div style="font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
                    letter-spacing:0.2em;text-transform:uppercase;color:{style['muted']};
                    margin-bottom:2rem;">Story {num}</div>
                {applies_badge}
                <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.8rem,6vw,5.5rem);
                    font-weight:900;line-height:1.05;max-width:900px;margin:0;">
                    <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                    {display_title}</a></h2>
                {en_subtitle}
                {summary_html}
                {meta_html}
            </div>
        </section>"""

    elif layout == "midnight":
        return f"""
        <section style="min-height:100vh;background:linear-gradient(135deg,{style['bg']} 0%,#16213E 100%);
            color:{style['text']};display:flex;flex-direction:column;justify-content:center;
            padding:4rem 6vw;position:relative;overflow:hidden;">
            {img_html}
            <div style="position:absolute;top:3rem;right:6vw;font-family:'Fraunces',serif;
                font-size:10rem;font-weight:900;color:rgba(91,192,235,0.08);line-height:1;
                z-index:0;">{num}</div>
            <div style="{z1}">
                {applies_badge}
                <div style="font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
                    letter-spacing:0.2em;text-transform:uppercase;color:{style['accent']};
                    margin-bottom:1.5rem;">{category}</div>
                <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.4rem,5vw,4.5rem);
                    font-weight:800;line-height:1.1;max-width:850px;margin:0;">
                    <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                    {display_title}</a></h2>
                {en_subtitle}
                {summary_html}
                {meta_html}
            </div>
        </section>"""

    elif layout == "rose-stamp":
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;align-items:center;padding:4rem 6vw;position:relative;overflow:hidden;">
            <div style="position:absolute;top:50%;right:-2rem;transform:translateY(-50%) rotate(-12deg);
                font-family:'Fraunces',serif;font-size:22rem;font-weight:900;color:{style['accent']};
                opacity:0.12;line-height:1;">{num}</div>
            <div style="max-width:750px;position:relative;z-index:1;">
                {applies_badge}
                <div style="display:inline-block;border:3px solid {style['accent']};padding:4px 14px;
                    font-family:'Inter',sans-serif;font-size:0.75rem;font-weight:700;
                    letter-spacing:0.15em;text-transform:uppercase;color:{style['accent']};
                    margin-bottom:2rem;">{category}</div>
                <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.2rem,4.5vw,4rem);
                    font-weight:800;line-height:1.1;margin:0;">
                    <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                    {display_title}</a></h2>
                {en_subtitle}
                {summary_html}
                {img_html}
                {meta_html}
            </div>
        </section>"""

    elif layout == "terminal":
        mono = "'IBM Plex Mono','Courier New',monospace"
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;flex-direction:column;justify-content:center;padding:4rem 6vw;
            font-family:{mono};position:relative;">
            <div style="font-size:0.85rem;color:{style['muted']};margin-bottom:2rem;">
                igor@morning-edition:~$ cat story_{num}.md</div>
            {applies_badge}
            <div style="font-size:0.75rem;letter-spacing:0.15em;text-transform:uppercase;
                color:{style['accent']};margin-bottom:1rem;">[{category}]</div>
            <h2 style="font-family:{mono};font-size:clamp(1.8rem,4vw,3.2rem);font-weight:700;
                line-height:1.2;max-width:850px;margin:0;">
                <a href="{url}" style="color:{style['text']};text-decoration:none;" target="_blank">
                # {display_title}</a></h2>
            {en_subtitle.replace("'Inter'", mono)}
            {summary_html.replace("'Inter'", mono)}
            {img_html}
            <div style="font-size:0.9rem;color:{style['muted']};margin-top:1.5rem;">
                {points}pts | <a href="{comments_url}" style="color:{style['text']};"
                target="_blank">{comments} comments</a> | {escape(domain)}</div>
        </section>"""

    elif layout == "academic":
        dt = display_title
        fl = dt[0] if dt else "?"
        rest = dt[1:] if len(dt) > 1 else ""
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;flex-direction:column;justify-content:center;padding:4rem 6vw;
            position:relative;overflow:hidden;">
            {img_html}
            <div style="position:relative;z-index:1;">
                <div style="font-family:'Inter',sans-serif;font-size:0.75rem;font-weight:700;
                    letter-spacing:0.2em;text-transform:uppercase;color:{style['accent']};
                    margin-bottom:2rem;">No. {num} &mdash; {category}</div>
                {applies_badge}
                <h2 style="font-family:'Fraunces',serif;font-size:clamp(2rem,4vw,3.5rem);
                    font-weight:700;line-height:1.15;max-width:800px;margin:0;">
                    <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                    <span style="float:left;font-size:5.5rem;line-height:0.8;padding-right:0.15em;
                        color:{style['accent']};font-weight:900;">{escape(fl)}</span>{escape(rest)}</a></h2>
                <div style="clear:both;"></div>
                {en_subtitle}
                {summary_html}
                {meta_html}
            </div>
        </section>"""

    elif layout == "big-stat":
        return f"""
        <section style="min-height:100vh;background:linear-gradient(160deg,{style['bg']} 0%,#16213E 100%);
            color:{style['text']};display:flex;flex-direction:column;justify-content:center;
            align-items:center;padding:4rem 6vw;text-align:center;position:relative;">
            <div style="font-family:'Fraunces',serif;font-size:clamp(8rem,18vw,16rem);
                font-weight:900;color:{style['accent']};line-height:0.9;opacity:0.9;">{num}</div>
            {applies_badge}
            <div style="font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
                letter-spacing:0.2em;text-transform:uppercase;color:{style['muted']};
                margin:1.5rem 0;">{category}</div>
            <h2 style="font-family:'Fraunces',serif;font-size:clamp(2rem,4vw,3.5rem);
                font-weight:800;line-height:1.15;max-width:800px;margin:0;">
                <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                {display_title}</a></h2>
            {en_subtitle}
            {summary_html}
            {img_html}
            {meta_html}
        </section>"""

    elif layout == "warm-sand":
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;flex-direction:column;justify-content:center;padding:4rem 6vw;
            position:relative;">
            <div style="display:flex;align-items:baseline;gap:1.5rem;margin-bottom:2rem;">
                <span style="font-family:'Fraunces',serif;font-size:5rem;font-weight:900;
                    color:{style['accent']};line-height:1;">{num}</span>
                <span style="font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
                    letter-spacing:0.15em;text-transform:uppercase;color:{style['muted']};">
                    {category}</span>
            </div>
            {applies_badge}
            <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.2rem,4.5vw,4rem);
                font-weight:800;line-height:1.1;max-width:850px;margin:0;">
                <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                {display_title}</a></h2>
            {en_subtitle}
            {summary_html}
            {img_html}
            {meta_html}
        </section>"""

    elif layout == "deep-purple":
        return f"""
        <section style="min-height:100vh;background:radial-gradient(ellipse at 30% 50%,#2D1B69 0%,{style['bg']} 70%);
            color:{style['text']};display:flex;flex-direction:column;justify-content:center;
            padding:4rem 6vw;position:relative;overflow:hidden;">
            {img_html}
            <div style="position:absolute;bottom:3rem;right:6vw;font-family:'Fraunces',serif;
                font-size:12rem;font-weight:900;color:rgba(179,136,255,0.06);line-height:1;">{num}</div>
            <div style="position:relative;z-index:1;">
                {applies_badge}
                <div style="font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
                    letter-spacing:0.2em;text-transform:uppercase;color:{style['accent']};
                    margin-bottom:1.5rem;">{category}</div>
                <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.4rem,5vw,4.5rem);
                    font-weight:800;line-height:1.1;max-width:850px;margin:0;">
                    <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                    {display_title}</a></h2>
                {en_subtitle}
                {summary_html}
                {meta_html}
            </div>
        </section>"""

    elif layout == "newsprint":
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;flex-direction:column;justify-content:center;padding:4rem 6vw;
            position:relative;">
            <div style="width:100%;border-top:4px solid {style['text']};border-bottom:1px solid {style['text']};
                padding:0.5rem 0;margin-bottom:2.5rem;display:flex;justify-content:space-between;
                align-items:baseline;font-family:'Inter',sans-serif;font-size:0.75rem;font-weight:600;
                letter-spacing:0.15em;text-transform:uppercase;color:{style['muted']};">
                <span>Story {num}</span><span>{category}</span></div>
            {applies_badge}
            <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.4rem,5vw,4.5rem);
                font-weight:900;line-height:1.05;max-width:850px;margin:0;">
                <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                {display_title}</a></h2>
            {en_subtitle}
            {summary_html}
            {img_html}
            {meta_html}
        </section>"""

    else:  # closer
        return f"""
        <section style="min-height:100vh;background:{style['bg']};color:{style['text']};
            display:flex;flex-direction:column;justify-content:center;padding:4rem 6vw;
            position:relative;overflow:hidden;">
            {img_html}
            <div style="position:absolute;top:-3rem;left:6vw;font-family:'Fraunces',serif;
                font-size:18rem;font-weight:900;background:linear-gradient(180deg,{style['accent']},transparent);
                -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
                line-height:1;opacity:0.3;">{num}</div>
            <div style="{z1}">
                {applies_badge}
                <div style="font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
                    letter-spacing:0.2em;text-transform:uppercase;color:{style['accent']};
                    margin-bottom:1.5rem;">{category}</div>
                <h2 style="font-family:'Fraunces',serif;font-size:clamp(2.4rem,5vw,4.5rem);
                    font-weight:800;line-height:1.1;max-width:850px;margin:0;">
                    <a href="{url}" style="color:inherit;text-decoration:none;" target="_blank">
                    {display_title}</a></h2>
                {en_subtitle}
                {summary_html}
                {meta_html}
            </div>
        </section>"""


def _toc_item(i: int, s: dict) -> str:
    num = f"{i + 1:02d}"
    title_ru = escape(s.get("_title_ru", ""))
    title_en = escape(s.get("title", ""))
    display = title_ru if title_ru else title_en
    cat = escape(s.get("_category", "Tech"))
    src = escape(s.get("source", ""))
    dot = '<span style="display:inline-block;width:8px;height:8px;background:#C4553A;border-radius:50%;margin-left:0.5rem;"></span>' if s.get("_applies") else ""
    subtitle = f'<br><span style="font-size:0.8rem;color:#999;font-weight:400;">{title_en}</span>' if title_ru else ""
    return (
        f'<a href="#story-{i+1}" class="toc-item">'
        f'<span class="toc-num">{num}</span>'
        f'<span class="toc-title">{display}{subtitle}</span>'
        f'<span class="toc-cat">{cat} · {src}{dot}</span>'
        f'</a>'
    )


def render_magazine(stories: list[dict], date: str, theme: dict) -> str:
    spreads_list = theme.get("spreads", [])
    spreads = ""
    for i, story in enumerate(stories):
        style = spreads_list[i % len(spreads_list)] if spreads_list else {"bg": "#fff", "text": "#000", "accent": "#c00", "muted": "#888", "layout": "hero"}
        spreads += f'<div id="story-{i+1}">' + render_spread(i, story, style) + '</div>'

    toc_items = "\n        ".join(_toc_item(i, s) for i, s in enumerate(stories))

    weekday = datetime.strptime(date, "%Y-%m-%d").strftime("%A")
    month_day = datetime.strptime(date, "%Y-%m-%d").strftime("%B %-d, %Y")
    mag_title = CFG.get("magazine_title", "Morning Edition")
    cover_bg = theme.get("cover_bg", "linear-gradient(170deg, #0A0A0A 0%, #1A1A2E 50%, #0D1B2A 100%)")
    cover_glow = theme.get("cover_glow", "rgba(233, 69, 96, 0.08)")

    # Collect source labels used
    sources_used = sorted(set(s.get("source", "") for s in stories if s.get("source")))
    sources_str = " · ".join(sources_used)

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escape(mag_title)} &mdash; {date}</title>
    <meta name="description" content="Curated daily magazine, {month_day}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,700;0,9..144,800;0,9..144,900;1,9..144,400&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        *,*::before,*::after {{ box-sizing:border-box;margin:0;padding:0; }}
        html {{ scroll-behavior:smooth;-webkit-font-smoothing:antialiased; }}
        body {{ margin:0;padding:0;background:#111; }}
        a {{ transition:opacity 0.2s; }}
        a:hover {{ opacity:0.75; }}
        img {{ max-width:100%; }}
        .cover {{ min-height:100vh;background:{cover_bg};color:#F0F0F0;display:flex;
            flex-direction:column;justify-content:center;align-items:center;text-align:center;
            padding:4rem 2rem;position:relative; }}
        .cover::after {{ content:'';position:absolute;inset:0;
            background:radial-gradient(ellipse at 50% 40%,{cover_glow} 0%,transparent 60%); }}
        .cover-content {{ position:relative;z-index:1; }}
        .cover-eyebrow {{ font-family:'Inter',sans-serif;font-size:0.8rem;font-weight:600;
            letter-spacing:0.3em;text-transform:uppercase;color:#888;margin-bottom:2rem; }}
        .cover-title {{ font-family:'Fraunces',serif;font-size:clamp(4rem,10vw,9rem);
            font-weight:900;line-height:0.95;margin-bottom:1.5rem;
            background:linear-gradient(180deg,#FFFFFF 30%,#C0C0C0 100%);
            -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text; }}
        .cover-date {{ font-family:'Inter',sans-serif;font-size:1.1rem;font-weight:400;
            color:#999;letter-spacing:0.05em; }}
        .cover-sources {{ font-family:'Inter',sans-serif;font-size:0.75rem;color:#555;
            margin-top:1rem;letter-spacing:0.1em; }}
        .cover-scroll {{ position:absolute;bottom:2.5rem;left:50%;transform:translateX(-50%);
            font-family:'Inter',sans-serif;font-size:0.75rem;color:#555;letter-spacing:0.15em;
            text-transform:uppercase;z-index:1;animation:pulse 2s ease-in-out infinite; }}
        @keyframes pulse {{
            0%,100% {{ opacity:0.4;transform:translateX(-50%) translateY(0); }}
            50% {{ opacity:1;transform:translateX(-50%) translateY(4px); }}
        }}
        .toc {{ background:#F5F0E8;padding:5rem 6vw;min-height:60vh;display:flex;
            flex-direction:column;justify-content:center; }}
        .toc-header {{ font-family:'Fraunces',serif;font-size:1.4rem;font-weight:700;
            color:#1A1A1A;margin-bottom:3rem;letter-spacing:-0.01em; }}
        .toc-item {{ display:flex;align-items:baseline;gap:1.5rem;padding:1rem 0;
            border-bottom:1px solid rgba(0,0,0,0.08);text-decoration:none;
            color:#1A1A1A;transition:all 0.2s; }}
        .toc-item:hover {{ padding-left:0.5rem;opacity:1; }}
        .toc-num {{ font-family:'Fraunces',serif;font-size:1.1rem;font-weight:700;
            color:#C4553A;min-width:2rem; }}
        .toc-title {{ font-family:'Inter',sans-serif;font-size:1.05rem;font-weight:500;
            line-height:1.4;flex:1; }}
        .toc-cat {{ font-family:'Inter',sans-serif;font-size:0.7rem;font-weight:600;
            letter-spacing:0.1em;text-transform:uppercase;color:#999;white-space:nowrap; }}
        .footer {{ background:#0A0A0A;color:#555;padding:3rem 6vw;text-align:center;
            font-family:'Inter',sans-serif;font-size:0.8rem; }}
        @media (max-width:640px) {{ section {{ padding:3rem 5vw !important; }} }}
    </style>
</head>
<body>
    <div class="cover">
        <div class="cover-content">
            <div class="cover-eyebrow">{weekday}</div>
            <h1 class="cover-title">{escape(mag_title).replace(' ', '<br>')}</h1>
            <div class="cover-date">{month_day}</div>
            <div class="cover-sources">{escape(sources_str)}</div>
        </div>
        <div class="cover-scroll">&darr; листай</div>
    </div>

    <div class="toc">
        <div class="toc-header">Сегодня в выпуске</div>
        {toc_items}
    </div>

    {spreads}

    <div class="footer">
        {escape(mag_title)} &mdash; {date}<br>
        Sources: {escape(sources_str)} &middot;
        <a href="https://news.ycombinator.com" style="color:#888;">HN</a>
    </div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    title = CFG.get("magazine_title", "Morning Edition")
    print(f"[{TODAY}] {title}")

    stories = fetch_all_sources()
    if not stories:
        print("No stories fetched!")
        sys.exit(1)

    print(f"  Total: {len(stories)} stories from all sources")
    print(f"  Curating top {STORIES_COUNT}...")
    top = curate(stories, STORIES_COUNT)

    top = enrich_comments(top)
    top = enrich_images(top)
    top = enrich_llm(top)

    theme = get_theme(TODAY)
    print("  Rendering magazine...")
    html = render_magazine(top, TODAY, theme)

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{FILE_PREFIX}{TODAY}.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved to {path}")

    latest = os.path.join(OUT_DIR, f"{FILE_PREFIX}latest.html")
    with open(latest, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved to {latest}")
    return path


if __name__ == "__main__":
    path = main()
    print(f"\nDone! Open: {path}")
