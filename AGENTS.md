# Repository Guidance

This is a Next.js, React, and TypeScript personal knowledge AI app. It stores
notes locally, supports hybrid and embedding-based search, and can use the
OpenAI API when `OPENAI_API_KEY` is configured.

## Working guidelines

- Use the existing App Router patterns under `app/`.
- Keep server-only storage and retrieval code in `lib/` or API routes.
- Do not expose `OPENAI_API_KEY` or other secrets to client components.
- Prefer typed data contracts with Zod or TypeScript types for API boundaries.
- Keep local fallback behavior working when `OPENAI_API_KEY` is not set.

## Branch naming

- Use conventional branch names instead of tool-specific prefixes.
- Use `develop` as the shared integration branch when one is needed.
- Use `feature/<short-description>` for feature work.
- Use `fix/<short-description>` for bug fixes.
- Use `docs/<short-description>` for documentation-only changes.
- Use `chore/<short-description>` for maintenance changes.

## Verification

- Run `npm.cmd run lint` after code changes.
- Run `npm.cmd run build` for changes that affect routing, API routes, or shared app behavior.
- Run `npm.cmd run eval:search` for changes to search, ranking, embeddings, or answer generation.

## Review guidelines

- Treat secret exposure, client-side access to server credentials, or logging of sensitive note content as P1.
- Treat regressions that break note creation, note storage, search, answer generation, or local fallback behavior as P1.
- Check API routes for input validation, clear error responses, and accidental mutation during read-only operations.
- Check search and ranking changes against `docs/rag-contract.md` and the `eval:search` script when relevant.
- For UI changes, verify the main note/search workflow remains usable on desktop and mobile widths.
