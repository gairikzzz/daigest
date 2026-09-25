import { env } from "cloudflare:workers";

const CATEGORY_TO_CURRENTS: Record<string, string> = {
  World: "world", Local: "regional", Business: "business", Technology: "technology",
  Entertainment: "entertainment", Sports: "sports", Science: "science", Health: "health",
};
const CURRENTS_TO_CATEGORY: Record<string, string> = {
  general: "India", regional: "Local", technology: "Technology", politics: "India",
  business: "Business", finance: "Business", entertainment: "Entertainment",
  sports: "Sports", science: "Science", health: "Health", world: "World",
};
type CurrentsArticle = {
  id?: string; title?: string; description?: string; url?: string; image?: string;
  published?: string; category?: string[];
};

function publisherFromUrl(value?: string) {
  if (!value) return { name: "News source", domain: "" };
  try {
    const domain = new URL(value).hostname.replace(/^www\./, "");
    const name = domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return { name, domain };
  } catch { return { name: "News source", domain: "" }; }
}

export async function GET(request: Request) {
  const apiKey = (env as unknown as Record<string, string | undefined>).CURRENTS_API_KEY;
  if (!apiKey) return Response.json({ configured: false, stories: [] }, { headers: { "Cache-Control": "no-store" } });

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim() ?? "";
  const category = requestUrl.searchParams.get("category") ?? "Top stories";
  const upstream = new URL(`https://api.currentsapi.services/v1/${query ? "search" : "latest-news"}`);
  upstream.searchParams.set("language", "en");
  upstream.searchParams.set("page_size", "12");
  if (category !== "World") upstream.searchParams.set("country", "in");
  if (query) upstream.searchParams.set("keywords", query.slice(0, 180));
  if (category !== "Top stories" && category !== "India" && CATEGORY_TO_CURRENTS[category]) {
    upstream.searchParams.set("category", CATEGORY_TO_CURRENTS[category]);
  }

  try {
    const response = await fetch(upstream, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    const payload = await response.json() as { news?: CurrentsArticle[]; message?: string; msg?: string };
    if (!response.ok) {
      return Response.json(
        { configured: true, stories: [], error: payload.message || payload.msg || `Currents returned ${response.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const stories = (payload.news ?? []).filter((article) => article.title && article.url).map((article, index) => {
      const publisher = publisherFromUrl(article.url);
      const digest = article.description?.trim() || "Open the original report for the full story and latest details.";
      return {
        id: article.id || `${article.url}-${index}`,
        category: category !== "Top stories" ? category : CURRENTS_TO_CATEGORY[article.category?.[0] ?? ""] ?? "India",
        publishedAt: article.published || new Date().toISOString(), headline: article.title, digest, why: digest,
        sources: [publisher.name], sourceDomain: publisher.domain, sourceUrl: article.url, image: article.image || null,
        questions: ["What happened?", "Why does this matter?", "What should I watch next?"], live: true,
      };
    });
    return Response.json(
      { configured: true, stories, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=180, s-maxage=900, stale-while-revalidate=1800" } },
    );
  } catch {
    return Response.json({ configured: true, stories: [], error: "Currents is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
