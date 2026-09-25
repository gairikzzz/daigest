import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

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

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

const CLASSIFIED_CATEGORIES = new Set([
  "India", "World", "Local", "Business", "Technology", "Entertainment", "Sports", "Science", "Health",
]);

const CATEGORY_RULES: Record<string, string> = {
  India: "Materially about India, Indian institutions, Indian public life, or events with a direct and substantial Indian connection; not merely published by an Indian outlet.",
  World: "International or cross-border affairs with significance beyond one country's domestic news.",
  Local: "Indian state, city, district, civic, or other clearly regional/local affairs.",
  Business: "Companies, markets, banking, finance, trade, jobs, or the economy.",
  Technology: "Technology companies, digital products, computing, telecom, cybersecurity, or applied AI.",
  Entertainment: "Film, television, music, celebrities, streaming, arts, or popular culture.",
  Sports: "Teams, athletes, matches, tournaments, leagues, or sports governance.",
  Science: "Scientific research, space, discoveries, or evidence-led advances; not merely consumer technology.",
  Health: "Medicine, public health, healthcare, disease, wellbeing, or medical research.",
};

function getGeminiText(payload: GeminiResponse) {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

type EnrichedArticle = { article: CurrentsArticle; questions: string[] };

const fallbackQuestions = ["What happened?", "Why does this matter?", "What should I watch next?"];

async function enrichArticlesWithGemini(
  articles: CurrentsArticle[],
  category: string | undefined,
  apiKey?: string,
): Promise<EnrichedArticle[]> {
  if (!apiKey || articles.length === 0) {
    return articles.map((article) => ({ article, questions: fallbackQuestions }));
  }

  const shouldFilter = Boolean(category && CLASSIFIED_CATEGORIES.has(category));

  const candidates = articles.map((article, index) => ({
    id: String(index),
    title: article.title?.slice(0, 240) ?? "",
    description: article.description?.slice(0, 520) ?? "",
  }));

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        systemInstruction: { parts: [{
          text: "You are a precise news editor. Return every candidate id exactly once. When filtering is enabled, reject weak, incidental, misleading, or ambiguous category matches. When filtering is disabled, mark every story as matching. For every story, write exactly three short, natural starter questions that are specific to its headline and description. Questions must help a reader understand names, context, consequences, comparisons, or what happens next. Do not use generic prompts such as 'What happened?', 'Why does this matter?', or 'What should I watch next?'.",
        }] },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({
              filteringEnabled: shouldFilter,
              category: category ?? "Unfiltered results",
              definition: category ? CATEGORY_RULES[category] : undefined,
              candidates,
            }) }],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 2400,
          responseMimeType: "application/json",
          responseJsonSchema: {
              type: "object",
              properties: {
                decisions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      matches: { type: "boolean" },
                      questions: { type: "array", items: { type: "string" } },
                    },
                    required: ["id", "matches", "questions"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["decisions"],
              additionalProperties: false,
          },
        },
      }),
    });
    if (!response.ok) return articles.map((article) => ({ article, questions: fallbackQuestions }));
    const payload = await response.json() as GeminiResponse;
    const parsed = JSON.parse(getGeminiText(payload)) as {
      decisions?: Array<{ id: string; matches: boolean; questions: string[] }>;
    };
    const decisions = new Map((parsed.decisions ?? []).map((item) => [item.id, item]));
    if (decisions.size === 0) return articles.map((article) => ({ article, questions: fallbackQuestions }));
    return articles.flatMap((article, index) => {
      const decision = decisions.get(String(index));
      if (shouldFilter && !decision?.matches) return [];
      const questions = (decision?.questions ?? []).map((question) => question.trim()).filter(Boolean).slice(0, 3);
      return [{ article, questions: questions.length >= 2 ? questions : fallbackQuestions }];
    });
  } catch {
    return articles.map((article) => ({ article, questions: fallbackQuestions }));
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
  // Currents' free tier caps page_size at 20. A larger value makes the
  // upstream return 400, which prevents the feed from refreshing.
  upstream.searchParams.set("page_size", isSearch ? "12" : "20");
  if (!isSearch && category !== "World") upstream.searchParams.set("country", "in");
  if (isSearch) upstream.searchParams.set("keywords", query.slice(0, 180));
  if (!isSearch && category !== "Top stories" && category !== "India" && CATEGORY_TO_CURRENTS[category]) {
    upstream.searchParams.set("category", CATEGORY_TO_CURRENTS[category]);
  }

  try {
    const response = await fetch(upstream, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json() as { news?: CurrentsArticle[]; message?: string; msg?: string };
    if (!response.ok) {
      return Response.json(
        { configured: true, stories: [], error: payload.message || payload.msg || `Currents returned ${response.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const candidates = (payload.news ?? []).filter((article) => article.title && article.url);
    const enrichedArticles = await enrichArticlesWithGemini(
      candidates,
      isSearch || category === "Top stories" ? undefined : category,
      bindings.GEMINI_API_KEY,
    );
    const stories = enrichedArticles.slice(0, 12).map(({ article, questions }, index) => {
      const publisher = publisherFromUrl(article.url);
      const digest = article.description?.trim() || "Open the original report for the full story and latest details.";
      return {
        id: article.id || `${article.url}-${index}`,
        category: category !== "Top stories" ? category : CURRENTS_TO_CATEGORY[article.category?.[0] ?? ""] ?? "India",
        publishedAt: article.published || new Date().toISOString(), headline: article.title, digest, why: digest,
        sources: [publisher.name], sourceDomain: publisher.domain, sourceUrl: article.url, image: article.image || null,
        questions, live: true,
      };
    });
    return Response.json(
      { configured: true, stories, fetchedAt: new Date().toISOString(), categoryChecked: !isSearch && CLASSIFIED_CATEGORIES.has(category) },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" } },
    );
  } catch {
    return Response.json({ configured: true, stories: [], error: "Currents is temporarily unavailable." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
