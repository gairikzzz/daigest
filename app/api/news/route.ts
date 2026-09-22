import { env } from "cloudflare:workers";

const CATEGORY_TO_NEWSDATA: Record<string, string> = {
  World: "world", Local: "domestic", Business: "business", Technology: "technology",
  Entertainment: "entertainment", Sports: "sports", Science: "science", Health: "health",
};
const NEWSDATA_TO_CATEGORY: Record<string, string> = {
  top: "India", domestic: "Local", business: "Business", technology: "Technology",
  entertainment: "Entertainment", sports: "Sports", science: "Science", health: "Health",
  politics: "India", world: "World",
};
type NewsDataArticle = {
  article_id?: string; title?: string; description?: string; link?: string; image_url?: string;
  pubDate?: string; source_id?: string; source_name?: string; source_url?: string; category?: string[];
};

function publisherFromArticle(article: NewsDataArticle) {
  const name = article.source_name?.trim() || article.source_id?.trim() || "News source";
  const value = article.source_url || article.link;
  if (!value) return { name, domain: "" };
  try { return { name, domain: new URL(value).hostname.replace(/^www\./, "") }; }
  catch { return { name, domain: "" }; }
}

export async function GET(request: Request) {
  const apiKey = (env as unknown as Record<string, string | undefined>).NEWSDATA_API_KEY;
  if (!apiKey) return Response.json({ configured: false, stories: [] }, { headers: { "Cache-Control": "no-store" } });

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim() ?? "";
  const category = requestUrl.searchParams.get("category") ?? "Top stories";
  const upstream = new URL("https://newsdata.io/api/1/latest");
  upstream.searchParams.set("apikey", apiKey);
  upstream.searchParams.set("language", "en");
  upstream.searchParams.set("timezone", "asia/kolkata");
  upstream.searchParams.set("image", "1");
  upstream.searchParams.set("removeduplicate", "1");
  upstream.searchParams.set("size", "10");
  if (category !== "World") upstream.searchParams.set("country", "in");
  if (query) upstream.searchParams.set("q", query.slice(0, 100));
  if (CATEGORY_TO_NEWSDATA[category]) upstream.searchParams.set("category", CATEGORY_TO_NEWSDATA[category]);

  try {
    const response = await fetch(upstream, { headers: { Accept: "application/json" } });
    const payload = await response.json() as { status?: string; results?: NewsDataArticle[]; message?: string; results_message?: string };
    if (!response.ok || payload.status === "error") {
      return Response.json(
        { configured: true, stories: [], error: payload.results_message || payload.message || `NewsData returned ${response.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const stories = (payload.results ?? []).filter((article) => article.title && article.link).map((article, index) => {
      const publisher = publisherFromArticle(article);
      const digest = article.description?.trim() || "Open the original report for the full story and latest details.";
      return {
        id: article.article_id || `${article.link}-${index}`,
        category: category !== "Top stories" ? category : NEWSDATA_TO_CATEGORY[article.category?.[0] ?? ""] ?? "India",
        publishedAt: article.pubDate || new Date().toISOString(), headline: article.title, digest, why: digest,
        sources: [publisher.name], sourceDomain: publisher.domain, sourceUrl: article.link, image: article.image_url || null,
        questions: ["What happened?", "Why does this matter?", "What should I watch next?"], live: true,
      };
    });
    return Response.json(
      { configured: true, stories, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=180, s-maxage=900, stale-while-revalidate=1800" } },
    );
  } catch {
    return Response.json({ configured: true, stories: [], error: "NewsData is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
