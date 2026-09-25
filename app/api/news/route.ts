import { env } from "cloudflare:workers";

const CATEGORY_TO_CURRENTS: Record<string, string> = {
  Business: "economy_business_finance", Technology: "science_technology",
  Entertainment: "arts_culture_entertainment", Sports: "sport",
  Science: "science_technology", Health: "health",
};
const CURRENTS_TO_CATEGORY: Record<string, string> = {
  general: "India", society: "Local", science_technology: "Technology",
  politics_government: "India", economy_business_finance: "Business",
  arts_culture_entertainment: "Entertainment", sport: "Sports", health: "Health",
};
type CurrentsArticle = {
  id?: string; title?: string; description?: string; url?: string; image?: string;
  published?: string; category?: string[];
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const CLASSIFIED_CATEGORIES = new Set([
  "World", "Local", "Business", "Technology", "Entertainment", "Sports", "Science", "Health",
]);

const CATEGORY_RULES: Record<string, string> = {
  World: "International or cross-border affairs with significance beyond one country's domestic news.",
  Local: "Indian state, city, district, civic, or other clearly regional/local affairs.",
  Business: "Companies, markets, banking, finance, trade, jobs, or the economy.",
  Technology: "Technology companies, digital products, computing, telecom, cybersecurity, or applied AI.",
  Entertainment: "Film, television, music, celebrities, streaming, arts, or popular culture.",
  Sports: "Teams, athletes, matches, tournaments, leagues, or sports governance.",
  Science: "Scientific research, space, discoveries, or evidence-led advances; not merely consumer technology.",
  Health: "Medicine, public health, healthcare, disease, wellbeing, or medical research.",
};

function getOpenAIText(payload: OpenAIResponse) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

async function filterCategoryWithOpenAI(
  articles: CurrentsArticle[],
  category: string,
  apiKey?: string,
) {
  if (!apiKey || !CLASSIFIED_CATEGORIES.has(category) || articles.length === 0) return articles;

  const candidates = articles.map((article, index) => ({
    id: String(index),
    title: article.title?.slice(0, 240) ?? "",
    description: article.description?.slice(0, 520) ?? "",
  }));

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna",
        reasoning: { effort: "none" },
        input: [
          {
            role: "system",
            content: "You are a strict news-feed editor. Judge every supplied story independently. Keep a story only when its headline and description materially match the requested section. Reject weak, incidental, misleading, or ambiguous matches. Return every candidate id exactly once.",
          },
          {
            role: "user",
            content: JSON.stringify({ category, definition: CATEGORY_RULES[category], candidates }),
          },
        ],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "category_validation",
            strict: true,
            schema: {
              type: "object",
              properties: {
                decisions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { id: { type: "string" }, matches: { type: "boolean" } },
                    required: ["id", "matches"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["decisions"],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 900,
      }),
    });
    if (!response.ok) return articles;
    const payload = await response.json() as OpenAIResponse;
    const parsed = JSON.parse(getOpenAIText(payload)) as { decisions?: Array<{ id: string; matches: boolean }> };
    const accepted = new Set((parsed.decisions ?? []).filter((item) => item.matches).map((item) => item.id));
    return articles.filter((_, index) => accepted.has(String(index)));
  } catch {
    return articles;
  }
}

function publisherFromUrl(value?: string) {
  if (!value) return { name: "News source", domain: "" };
  try {
    const domain = new URL(value).hostname.replace(/^www\./, "");
    const name = domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return { name, domain };
  } catch { return { name: "News source", domain: "" }; }
}

export async function GET(request: Request) {
  const bindings = env as unknown as Record<string, string | undefined>;
  const apiKey = bindings.CURRENTS_API_KEY;
  if (!apiKey) return Response.json({ configured: false, stories: [] }, { headers: { "Cache-Control": "no-store" } });

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim() ?? "";
  const category = requestUrl.searchParams.get("category") ?? "Top stories";
  const isSearch = query.length > 0;
  const upstream = new URL(isSearch
    ? "https://api.currentsapi.services/v2/search"
    : "https://api.currentsapi.services/v2/latest-news");
  upstream.searchParams.set("language", "en");
  upstream.searchParams.set("page_size", isSearch ? "12" : "30");
  if (!isSearch && category !== "World") upstream.searchParams.set("country", "in");
  if (isSearch) upstream.searchParams.set("keywords", query.slice(0, 180));
  if (!isSearch && category !== "Top stories" && category !== "India" && CATEGORY_TO_CURRENTS[category]) {
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
    const candidates = (payload.news ?? []).filter((article) => article.title && article.url);
    const matchedArticles = isSearch
      ? candidates
      : await filterCategoryWithOpenAI(candidates, category, bindings.OPENAI_API_KEY);
    const stories = matchedArticles.slice(0, 12).map((article, index) => {
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
      { configured: true, stories, fetchedAt: new Date().toISOString(), categoryChecked: !isSearch && CLASSIFIED_CATEGORIES.has(category) },
      { headers: { "Cache-Control": "public, max-age=180, s-maxage=900, stale-while-revalidate=1800" } },
    );
  } catch {
    return Response.json({ configured: true, stories: [], error: "Currents is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
