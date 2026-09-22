# dAIgest development guide

## Product intent

dAIgest is an India-first news reader. Keep the interface compact, editorial and calm. Each story card should preserve this order: category and recency, headline, publisher with logo, a three-line body, then the Ask dAIgest conversation.

## Interaction requirements

- Category tabs use the Currents Latest News endpoint.
- The search field uses the Currents Search endpoint and remains debounced.
- Never expose `CURRENTS_API_KEY` to client code.
- Keep the sample feed as a graceful fallback when the provider is not configured or unavailable.
- Ask dAIgest stays inside its story card. Starter prompts appear on one line and disappear after the first question; the full conversation history remains scrollable.
- User questions align right with a user avatar. dAIgest replies align left with the dAIgest avatar.
- Story images end with the story-copy area; the conversation spans the full card width below it.

## Verification

Run these checks before committing:

```bash
git diff --check
npm run build
```

The live news route should remain dynamic and server-side. Never commit `.env.local`, API keys, build output, `.sites-runtime`, or Wrangler state.
