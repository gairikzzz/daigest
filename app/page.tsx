"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Clock3, ImageIcon, RefreshCw, Search, Send, Sparkles, UserRound } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Story = {
  id: string | number; category: string; time?: string; publishedAt?: string; updatedAt?: string; headline: string; digest: string;
  why: string; sources: string[]; questions: string[]; sourceDomain?: string; sourceUrl?: string;
  image?: string | null; live?: boolean; secondaryCategories?: string[]; rankScore?: number;
};

const ASK_API_BASE = (process.env.NEXT_PUBLIC_ASK_API_BASE ?? "").replace(/\/$/, "");

function apiUrl(path: string) {
  return `${ASK_API_BASE}${path}`;
}

function getSessionId() {
  const key = "daigest-session-id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function normalizeStory(value: unknown): Story | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const headline = String(item.headline ?? item.title ?? "").trim();
  const digest = String(item.card_summary ?? item.cardSummary ?? item.digest ?? item.body ?? item.summary ?? "").trim();
  if (!headline || !digest) return null;
  const sourceRecords = Array.isArray(item.sources) ? item.sources : [];
  const sources = sourceRecords.length
    ? sourceRecords.map((source) => typeof source === "string" ? source : String((source as Record<string, unknown>)?.name ?? "")).filter(Boolean)
    : [String(item.source ?? item.publisher ?? "News source")];
  const firstSource = typeof sourceRecords[0] === "object" && sourceRecords[0] !== null
    ? sourceRecords[0] as Record<string, unknown>
    : undefined;
  const questionValues = item.questions ?? item.starterQuestions ?? item.starter_questions;
  const questions = Array.isArray(questionValues)
    ? questionValues.map(String).filter(Boolean)
    : ["What happened?", "Why is this important?", "What happens next?"];
  return {
    id: String(item.id ?? item.storyId ?? item.providerId ?? headline),
    // The UI tag and category tabs are both driven by the model's single
    // primary category. A provider/raw category is only a final legacy fallback.
    category: String(item.primary_category ?? item.primaryCategory ?? item.category ?? "India"),
    secondaryCategories: Array.isArray(item.secondaryCategories ?? item.secondary_categories)
      ? (item.secondaryCategories ?? item.secondary_categories as unknown[]).map(String)
      : [],
    publishedAt: String(item.publishedAt ?? item.published_at ?? item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
    updatedAt: String(item.updatedAt ?? item.updated_at ?? item.publishedAt ?? item.published_at ?? new Date().toISOString()),
    rankScore: Number(item.rankScore ?? item.rank_score ?? 0) || 0,
    headline,
    digest,
    why: String(item.why ?? item.whyItMatters ?? digest),
    sources: sources.length ? sources : ["News source"],
    questions: questions.length ? questions : ["What happened?", "Why is this important?", "What happens next?"],
    sourceDomain: String(item.sourceDomain ?? item.source_domain ?? firstSource?.domain ?? "") || undefined,
    sourceUrl: String(item.sourceUrl ?? item.source_url ?? item.url ?? firstSource?.url ?? "") || undefined,
    image: String(item.image ?? item.imageUrl ?? item.image_url ?? "") || null,
    live: true,
  };
}

function sortStories(stories: Story[]) {
  return [...stories].sort((left, right) => {
    const importance = (right.rankScore ?? 0) - (left.rankScore ?? 0);
    if (importance !== 0) return importance;
    return new Date(right.updatedAt ?? right.publishedAt ?? 0).getTime()
      - new Date(left.updatedAt ?? left.publishedAt ?? 0).getTime();
  });
}

const sampleStories: Story[] = [
  { id: 1, category: "World", time: "18 min ago", headline: "BRICS nations advance a shared cross-border payments framework", digest: "Finance ministers from BRICS countries have agreed to test a common settlement network designed to make trade payments faster and less dependent on existing Western-led infrastructure.", why: "A workable alternative could reshape how emerging economies trade and reduce transaction costs — but it also raises questions about regulation, trust and geopolitical influence.", sources: ["Reuters", "The Hindu", "BBC"], sourceDomain: "reuters.com", questions: ["What is BRICS?", "Why does this matter to India?", "How is this different from SWIFT?"] },
  { id: 2, category: "Technology", time: "42 min ago", headline: "India proposes a national framework for safe AI deployment", digest: "The draft framework focuses on transparency, risk assessments and accountability for high-impact AI systems, with stricter oversight in healthcare, finance and public services.", why: "The rules could determine how quickly AI products reach Indian users and what safeguards companies must build before launch.", sources: ["Economic Times", "Mint", "PIB"], sourceDomain: "economictimes.indiatimes.com", questions: ["What counts as high-risk AI?", "How does this compare with the EU AI Act?", "What changes for startups?"] },
  { id: 3, category: "Business", time: "1 hr ago", headline: "RBI keeps the repo rate unchanged as inflation eases", digest: "The central bank has held its key lending rate steady, balancing softer inflation with uncertainty in food prices and global markets. Borrowing costs are expected to remain broadly stable.", why: "The decision affects loan EMIs, savings returns, business investment and the pace of economic growth.", sources: ["RBI", "Business Standard", "Reuters"], sourceDomain: "rbi.org.in", questions: ["What is the repo rate?", "Will my loan EMI change?", "Why not cut rates now?"] },
  { id: 4, category: "Sports", time: "2 hrs ago", headline: "India announces its squad for the upcoming home series", digest: "Selectors have blended experienced players with two first-time call-ups after strong domestic performances, while testing a new opening combination.", why: "The selections signal how the team is planning its next generation and upcoming tournament cycle.", sources: ["BCCI", "ESPNcricinfo"], sourceDomain: "bcci.tv", questions: ["Who are the new players?", "Who missed out?", "When does the series begin?"] },
];

const categories = ["India", "World", "Local", "Business", "Technology", "Entertainment", "Sports", "Science", "Health"];

function relativeTime(story: Story) {
  if (!story.publishedAt) return story.time ?? "Just now";
  const elapsed = Math.max(0, Date.now() - new Date(story.publishedAt).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function PublisherLogo({ name, domain }: { name: string; domain?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="publisher-logo">{!domain || failed ? name.slice(0, 2).toUpperCase() : <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} width={24} height={24} alt="" onError={() => setFailed(true)} />}</span>;
}

function StoryPhoto({ story }: { story: Story }) {
  const [failed, setFailed] = useState(false);
  if (story.image && !failed) return <div className="photo-slot has-photo"><img src={story.image} alt="" onError={() => setFailed(true)} /></div>;
  return <div className="photo-slot" role="img" aria-label={`Photo space for ${story.headline}`}><ImageIcon size={28} strokeWidth={1.3}/><span>Story photo</span></div>;
}

function FittingPromptTags({ questions, onAsk }: { questions: string[]; onAsk: (question: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  useLayoutEffect(() => {
    const row = container.current;
    const strip = measure.current;
    if (!row || !strip) return;
    const update = () => {
      const available = row.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      let used = 0;
      let count = 0;
      for (const tag of Array.from(strip.children)) {
        const next = used + (count ? gap : 0) + tag.getBoundingClientRect().width;
        if (next > available) break;
        used = next;
        count++;
      }
      setVisibleCount(count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [questions]);
  return <div className="prompt-tags" ref={container}>
    <div className="prompt-measure" ref={measure} aria-hidden="true">{questions.map((question, index) => <span key={question} className={`prompt-tag prompt-tone-${index}`}>{question}</span>)}</div>
    {questions.slice(0, visibleCount).map((question, index) => <button key={question} className={`prompt-tag prompt-tone-${index}`} onClick={() => onAsk(question)}>{question}</button>)}
  </div>;
}

type Citation = { title: string; url: string };
type ChatTurn = { id: string; question: string; answer: string; citations?: Citation[]; pending?: boolean };
function StoryCard({ story }: { story: Story }) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  async function ask(value: string) {
    const question = value.trim();
    if (!question || asking) return;
    const id = `${Date.now()}-${Math.random()}`;
    setInput("");
    setAsking(true);
    setTurns((current) => [...current, { id, question, answer: "Thinking…", pending: true }]);
    try {
      if (!ASK_API_BASE) throw new Error("Ask dAIgest is not configured yet.");
      const response = await fetch(apiUrl("/api/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ storyId: String(story.id), question, sessionId: getSessionId() }),
      });
      const payload = await response.json() as { answer?: string; citations?: Citation[]; error?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error || "Could not answer that question.");
      setTurns((current) => current.map((turn) => turn.id === id
        ? { ...turn, answer: payload.answer!, citations: payload.citations, pending: false }
        : turn));
    } catch (error) {
      setTurns((current) => current.map((turn) => turn.id === id
        ? { ...turn, answer: (error as Error).message || "I couldn’t answer that right now.", pending: false }
        : turn));
    } finally {
      setAsking(false);
    }
  }
  useLayoutEffect(() => { if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight; }, [turns]);
  const publisher = story.sources[0] || "News source";
  return <article className="news-card">
    <StoryPhoto story={story}/>
    <div className="card-copy">
      <div className="story-meta"><span className="category-label">{story.category}</span><span>·</span><Clock3 size={12}/><span>{relativeTime(story)}</span></div>
      <h2>{story.sourceUrl ? <a href={story.sourceUrl} target="_blank" rel="noreferrer">{story.headline}</a> : story.headline}</h2>
      <div className="publisher"><PublisherLogo name={publisher} domain={story.sourceDomain}/><span>{publisher}</span>{!story.live && <span className="source-count">+{story.sources.length - 1} sources</span>}</div>
      <p className="digest">{story.digest}</p>
    </div>
    <div className="card-conversation">
      <div className="conversation-label"><span className="conversation-logo"><Sparkles size={13}/></span><strong>Ask dAIgest</strong></div>
      {turns.length > 0 && <div className="chat-history" ref={historyRef} aria-live="polite">{turns.map((turn, index) => <div className="chat-turn" key={index}>
        <div className="chat-message user-message"><p className="current-question">{turn.question}</p><span className="chat-avatar user-avatar" aria-label="You"><UserRound size={13}/></span></div>
        <div className="chat-message ai-message"><span className="chat-avatar ai-avatar" aria-label="dAIgest"><Sparkles size={12}/></span><div className="answer-stack"><p className={`current-answer ${turn.pending ? "is-thinking" : ""}`}>{turn.answer}</p>{turn.citations && turn.citations.length > 0 && <div className="answer-sources">{turn.citations.slice(0, 3).map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>)}</div>}</div></div>
      </div>)}</div>}
      {turns.length === 0 && <FittingPromptTags questions={story.questions} onAsk={ask}/>}<form onSubmit={(event) => { event.preventDefault(); void ask(input); }} className="question-input"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={turns.length ? "Ask a follow-up…" : "Ask about this story…"} aria-label="Ask about this story" disabled={asking}/><button disabled={!input.trim() || asking} aria-label="Send question"><Send size={15}/></button></form>
    </div>
  </article>;
}

export default function Home() {
  const [category, setCategory] = useState("Top stories");
  const [query, setQuery] = useState("");
  const [briefing, setBriefing] = useState(false);
  const [liveStories, setLiveStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFeedError("");
      try {
        if (!supabase) throw new Error("Supabase is not configured.");
        let result = await supabase
          .from("stories_live")
          .select("*")
          .eq("status", "published")
          .order("rank_score", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false })
          .limit(60)
          .abortSignal(controller.signal);
        if (result.error?.code === "42703") {
          result = await supabase
            .from("stories_live")
            .select("*")
            .eq("status", "published")
            .order("published_at", { ascending: false })
            .limit(60)
            .abortSignal(controller.signal);
        }
        if (result.error) throw result.error;
        setLiveStories(sortStories((result.data ?? []).map(normalizeStory).filter((story): story is Story => Boolean(story))));
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFeedError((error as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [refreshKey]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("daigest-stories-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "stories_live" }, (payload) => {
        const oldId = String((payload.old as Record<string, unknown> | null)?.id ?? "");
        const next = normalizeStory(payload.new);
        setLiveStories((current) => {
          if (payload.eventType === "DELETE" || !next || (payload.new as Record<string, unknown>)?.status !== "published") {
            return oldId ? current.filter((story) => String(story.id) !== oldId) : current;
          }
          const withoutCurrent = current.filter((story) => String(story.id) !== String(next.id));
          return sortStories([next, ...withoutCurrent]);
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const fallbackStories = useMemo(() => sampleStories.filter((story) =>
    (category === "Top stories" || story.category === category || (category === "India" && story.headline.includes("India"))) &&
    (`${story.headline} ${story.digest}`).toLowerCase().includes(query.toLowerCase())
  ), [category, query]);
  const usingLive = isSupabaseConfigured && !feedError;
  const categoryStories = category === "Top stories"
    ? liveStories
    : liveStories.filter((story) => story.category === category);
  const visibleSource = usingLive ? categoryStories : fallbackStories;
  const visible = query.trim()
    ? visibleSource.filter((story) => `${story.headline} ${story.digest} ${story.sources.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
    : visibleSource;
  const briefingStories = visible.length ? visible.slice(0, 4) : sampleStories;

  return <main className="editorial-app">
    <header className="masthead"><div className="masthead-inner">
      <a href="#" onClick={(event) => { event.preventDefault(); setCategory("Top stories"); setQuery(""); }} className="brand">d<span>AI</span>gest<span className="brand-dot">.</span></a>
      <label className="search-field"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded stories" aria-label="Search loaded stories"/></label>
      <button className="header-brief" onClick={() => { setBriefing(!briefing); document.getElementById("briefing")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}><Sparkles size={15}/>Your briefing</button>
    </div></header>
    <div className="edition">
      <div className="edition-heading"><div><p className="eyebrow">A LITTLE NEWS. A LOT MORE CONTEXT.</p><h1>Read less. <span>Understand more.</span></h1></div><button type="button" className={`feed-status ${usingLive ? "is-live" : ""}`} onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="Refresh latest news"><i/>{loading ? "Refreshing…" : usingLive ? "Refresh latest news" : "Retry live feed"}<RefreshCw size={11} className={loading ? "is-spinning" : ""}/></button></div>
      <Tabs value={category} onValueChange={(nextCategory) => { setCategory(nextCategory); setQuery(""); }} className="category-nav"><TabsList className="category-list"><TabsTrigger value="Top stories" className="category-tab">Top stories</TabsTrigger>{categories.map((name) => <TabsTrigger key={name} value={name} className="category-tab">{name}</TabsTrigger>)}</TabsList></Tabs>
      <div className="editorial-layout">
        <section className={`feed ${loading ? "is-loading" : ""}`} aria-label="News feed" aria-busy={loading}>
          {feedError && <div className="feed-notice">Live refresh paused: {feedError}</div>}
          {visible.length ? visible.map((story) => <StoryCard key={story.id} story={story}/>) : <div className="empty-feed"><ImageIcon size={25}/><h2>No stories found</h2><p>{query ? "Try a broader search." : "Check this category again shortly."}</p><button onClick={() => { setCategory("Top stories"); setQuery(""); }}>Back to top stories</button></div>}
        </section>
        <aside className="right-rail" id="briefing">
          <section className="briefing-card"><div className="briefing-meta"><Sparkles size={19}/><span>THE SHORT VERSION</span></div><h2>Your world,<br/>in a few minutes.</h2><p>Fresh stories to get you up to speed. Ask a little deeper on any of them.</p><button onClick={() => setBriefing(!briefing)}>{briefing ? "Close briefing" : "Catch me up"}<ArrowUpRight size={17}/></button>{briefing && <ol className="briefing-list">{briefingStories.map((story) => <li key={story.id}><strong>{story.category}</strong><p>{story.headline}</p></li>)}</ol>}<div className="briefing-foot">{briefingStories.length} stories <span>·</span> A quick read</div></section>
          <section className="rail-note"><p className="eyebrow">BEYOND THE HEADLINE</p><h3>Curiosity looks good on you.</h3><p>Ask dAIgest on any story. Your questions and replies stay with the context.</p></section>
          <div className="rail-footer"><span className="small-brand">dAIgest.</span><p>{usingLive ? "India-first reporting, prepared in Supabase by dAIgest." : "Sample stories are shown until Supabase is connected."}</p></div>
        </aside>
      </div>
    </div>
  </main>;
}
