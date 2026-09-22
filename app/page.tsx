"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Clock3, ImageIcon, Search, Send, Sparkles, UserRound } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Story = {
  id: string | number; category: string; time?: string; publishedAt?: string; headline: string; digest: string;
  why: string; sources: string[]; questions: string[]; sourceDomain?: string; sourceUrl?: string;
  image?: string | null; live?: boolean;
};

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

function answerFor(story: Story, question: string) {
  if (question.toLowerCase().includes("brics")) return "BRICS is an intergovernmental group of major emerging economies. In this story, members are exploring a payment network that could make trade settlement faster and less reliant on existing systems.";
  if (question.toLowerCase().includes("repo")) return "The repo rate is the interest rate at which the RBI lends short-term funds to commercial banks. Since it remains unchanged, lending rates are unlikely to move immediately for that reason alone.";
  return story.live ? `Based on the available report: ${story.digest}` : story.why;
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

type ChatTurn = { question: string; answer: string };
function StoryCard({ story }: { story: Story }) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  function ask(value: string) {
    const question = value.trim();
    if (!question) return;
    setInput("");
    setTurns((current) => [...current, { question, answer: answerFor(story, question) }]);
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
        <div className="chat-message ai-message"><span className="chat-avatar ai-avatar" aria-label="dAIgest"><Sparkles size={12}/></span><p className="current-answer">{turn.answer}</p></div>
      </div>)}</div>}
      {turns.length === 0 && <FittingPromptTags questions={story.questions} onAsk={ask}/>}<form onSubmit={(event) => { event.preventDefault(); ask(input); }} className="question-input"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={turns.length ? "Ask a follow-up…" : "Ask about this story…"} aria-label="Ask about this story"/><button disabled={!input.trim()} aria-label="Send question"><Send size={15}/></button></form>
    </div>
  </article>;
}

type NewsResponse = { configured: boolean; stories: Story[]; error?: string };

export default function Home() {
  const [category, setCategory] = useState("Top stories");
  const [query, setQuery] = useState("");
  const [briefing, setBriefing] = useState(false);
  const [liveStories, setLiveStories] = useState<Story[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFeedError("");
      try {
        const params = new URLSearchParams({ category });
        if (query.trim()) params.set("q", query.trim());
        const response = await fetch(`/api/news?${params}`, { signal: controller.signal });
        const payload = await response.json() as NewsResponse;
        setConfigured(payload.configured);
        if (!response.ok) throw new Error(payload.error || "Could not refresh the feed.");
        setLiveStories(payload.stories || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFeedError((error as Error).message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query.trim() ? 450 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [category, query]);

  const fallbackStories = useMemo(() => sampleStories.filter((story) =>
    (category === "Top stories" || story.category === category || (category === "India" && story.headline.includes("India"))) &&
    (`${story.headline} ${story.digest}`).toLowerCase().includes(query.toLowerCase())
  ), [category, query]);
  const usingLive = configured === true && !feedError;
  const visible = usingLive ? liveStories : fallbackStories;
  const briefingStories = visible.length ? visible.slice(0, 4) : sampleStories;

  return <main className="editorial-app">
    <header className="masthead"><div className="masthead-inner">
      <a href="#" onClick={(event) => { event.preventDefault(); setCategory("Top stories"); setQuery(""); }} className="brand">d<span>AI</span>gest<span className="brand-dot">.</span></a>
      <label className="search-field"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Indian news" aria-label="Search the news"/></label>
      <button className="header-brief" onClick={() => { setBriefing(!briefing); document.getElementById("briefing")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}><Sparkles size={15}/>Your briefing</button>
    </div></header>
    <div className="edition">
      <div className="edition-heading"><div><p className="eyebrow">A LITTLE NEWS. A LOT MORE CONTEXT.</p><h1>Read less. <span>Understand more.</span></h1></div><span className={`feed-status ${usingLive ? "is-live" : ""}`}><i/>{loading ? "Refreshing…" : usingLive ? "Live via Currents" : "Demo fallback"}</span></div>
      <Tabs value={category} onValueChange={setCategory} className="category-nav"><TabsList className="category-list"><TabsTrigger value="Top stories" className="category-tab">Top stories</TabsTrigger>{categories.map((name) => <TabsTrigger key={name} value={name} className="category-tab">{name}</TabsTrigger>)}</TabsList></Tabs>
      <div className="editorial-layout">
        <section className={`feed ${loading ? "is-loading" : ""}`} aria-label="News feed" aria-busy={loading}>
          {feedError && <div className="feed-notice">Live refresh paused. Showing the last available stories.</div>}
          {visible.length ? visible.map((story) => <StoryCard key={story.id} story={story}/>) : <div className="empty-feed"><ImageIcon size={25}/><h2>No stories found</h2><p>{query ? "Try a broader search." : "Check this category again shortly."}</p><button onClick={() => { setCategory("Top stories"); setQuery(""); }}>Back to top stories</button></div>}
        </section>
        <aside className="right-rail" id="briefing">
          <section className="briefing-card"><div className="briefing-meta"><Sparkles size={19}/><span>THE SHORT VERSION</span></div><h2>Your world,<br/>in a few minutes.</h2><p>Fresh stories to get you up to speed. Ask a little deeper on any of them.</p><button onClick={() => setBriefing(!briefing)}>{briefing ? "Close briefing" : "Catch me up"}<ArrowUpRight size={17}/></button>{briefing && <ol className="briefing-list">{briefingStories.map((story) => <li key={story.id}><strong>{story.category}</strong><p>{story.headline}</p></li>)}</ol>}<div className="briefing-foot">{briefingStories.length} stories <span>·</span> A quick read</div></section>
          <section className="rail-note"><p className="eyebrow">BEYOND THE HEADLINE</p><h3>Curiosity looks good on you.</h3><p>Ask dAIgest on any story. Your questions and replies stay with the context.</p></section>
          <div className="rail-footer"><span className="small-brand">dAIgest.</span><p>{usingLive ? "Live headlines and search via Currents News API." : "Sample stories are shown until Currents is connected."}</p></div>
        </aside>
      </div>
    </div>
  </main>;
}
