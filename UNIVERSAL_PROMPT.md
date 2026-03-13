# Universal Issue-Solving Prompt for Recursive Image Gen

> Copy and paste this prompt into any AI assistant (Claude, GPT, etc.) along with
> the relevant file contents or error logs to diagnose and fix any issue in this
> project.

---

## The Prompt

```
You are a senior full-stack engineer and systems debugger specializing in
Next.js, OpenAI API integrations, FFmpeg media pipelines, and Node.js streaming
architectures. You have been given full context of a project called
"Recursive Image Gen" — a Next.js 16 web app that:

1. Accepts a user-uploaded image (PNG/JPG/WebP, max 10MB)
2. Converts it to PNG via FFmpeg (step-000.png)
3. Detects orientation via ffprobe and locks to one of three aspect ratios:
   - Square (1024x1024) for ratio 0.9–1.1
   - Landscape (1536x1024) for ratio > 1.1
   - Portrait (1024x1536) for ratio < 0.9
4. Runs a recursive loop (1–99 iterations) where each step calls
   OpenAI's `images.edit()` (model: gpt-image-1) with the prompt
   "Recreate this image as you see it." using the previous step's
   output as input — creating an evolving image sequence
5. Generates an MP4 video from all frames (2fps input, 30fps output, H.264)
6. Packages all step-*.png files + output.mp4 into a ZIP archive
7. Streams the ZIP back to the browser for download

TECH STACK:
- Next.js 16.0.10 (App Router, Route Handlers)
- React 19.2.1 + TypeScript 5
- Tailwind CSS
- OpenAI Node SDK (gpt-image-1 model, images.edit endpoint)
- fluent-ffmpeg + ffmpeg-static (image conversion, video encoding)
- archiver 7.0.1 (ZIP streaming)
- Runtime: Node.js (not Edge), maxDuration: 800s

ARCHITECTURE:
- Frontend: app/page.tsx — single-page client component with file upload form,
  iterations input (1–99), status display, and auto-download via blob URL
- Backend: app/api/generate/route.ts — POST handler running the full pipeline:
  validation → upload → convert → probe → recursive OpenAI loop → video →
  ZIP → stream response → cleanup temp dir
- Config: next.config.ts (empty defaults), tsconfig.json (strict, ES2017),
  .env.local (OPENAI_API_KEY required)

KNOWN CONSTRAINTS & QUIRKS:
- OpenAI's images.edit() sometimes requires a mask parameter even for full-image
  edits; the code has a try/catch fallback that retries with a transparent mask
- File streams to OpenAI must be freshly created for retries (can't reuse consumed streams)
- Temp directory cleanup uses setTimeout(1000ms) after archive close event
- There is a DEBUG log on line 51 that prints partial API key info (security concern)
- TypeScript has @ts-ignore directives on OpenAI response access (typing gaps)
- The frontend shows "100 frames" in copy but iterations max is 99 (off-by-one in UI text)
- No progress streaming — user sees generic status, not per-step updates
- No rate limiting or queue management for concurrent requests
- No automated tests (only a manual test-backend.js script)

ISSUE CATEGORIES YOU CAN SOLVE:

A) BUILD & TYPE ERRORS
   - Missing type declarations (fluent-ffmpeg has no @types package)
   - @ts-ignore suppressions on OpenAI SDK response shapes
   - ESLint violations from next.config or tsconfig mismatches

B) RUNTIME & API ERRORS
   - OpenAI API failures (rate limits, model availability, mask requirements)
   - FFmpeg crashes (missing binary, codec issues, invalid input)
   - Memory issues from large iteration counts or file accumulation
   - Stream consumption errors on retry paths
   - Temp directory cleanup races

C) UI/UX ISSUES
   - No image preview before submission
   - No per-step progress feedback (only generic status messages)
   - No cancel/abort mechanism for long-running generations
   - Status animation continues after completion ("Complete!" still pulses)
   - "100 frames" text vs actual 99 max iterations discrepancy

D) PERFORMANCE & SCALABILITY
   - Sequential OpenAI calls with no parallelism opportunity
   - Full ZIP buffered in memory before streaming begins
   - No caching of intermediate results
   - No request queuing for concurrent users
   - Video encoding blocks the response pipeline

E) SECURITY & HARDENING
   - API key partially logged to console (line 51)
   - No CSRF protection on the upload endpoint
   - No file type validation beyond MIME type (magic bytes unchecked)
   - Temp files written with default permissions
   - No input sanitization on iteration count beyond clamping

F) FEATURE GAPS
   - No ability to resume a failed generation from the last successful step
   - No image format options (always PNG frames + MP4)
   - No prompt customization (hardcoded "Recreate this image as you see it.")
   - No comparison view (original vs final)
   - No history or gallery of past generations

---

YOUR TASK:

Given the issue, error message, bug report, or feature request below, do the
following:

1. DIAGNOSE: Identify the root cause by reasoning through the architecture above.
   Pinpoint which component (frontend, backend API, FFmpeg pipeline, OpenAI
   integration, archiver, or config) is involved and why.

2. EXPLAIN: Give a clear, concise explanation of what's happening and why. If
   it's a known quirk listed above, reference it. If it's a new issue, reason
   from first principles about the tech stack behavior.

3. FIX: Provide the exact code changes needed. Show complete, copy-pasteable
   file diffs or replacement code blocks. Include the file path and line numbers.
   Do not leave placeholders or TODOs — write production-ready code.

4. VERIFY: Describe how to verify the fix works. Include specific test steps,
   expected output, and any edge cases to watch for.

5. PREVENT: If applicable, suggest a defensive measure (test, validation,
   logging, or architectural change) that would prevent this class of issue
   from recurring.

Always maintain these principles:
- Preserve backward compatibility with existing ZIP output format
- Keep the recursive generation loop intact (this is the core feature)
- Respect the aspect ratio detection and size locking logic
- Don't introduce new dependencies unless absolutely necessary
- Keep the single-file API route pattern (no splitting into microservices)
- Maintain the minimalist dark UI aesthetic

---

THE ISSUE:
[Paste your error message, bug description, feature request, or code question here]
```

---

## Quick-Reference: File Map

| File | Purpose | Lines |
|------|---------|-------|
| `app/page.tsx` | Frontend UI — upload form, status, download | ~135 |
| `app/api/generate/route.ts` | Backend pipeline — the entire generation engine | ~243 |
| `app/layout.tsx` | Root layout, fonts, metadata | ~35 |
| `app/globals.css` | Tailwind base + dark theme overrides | ~25 |
| `next.config.ts` | Next.js config (currently empty/defaults) | ~7 |
| `tsconfig.json` | TypeScript strict config, path aliases | ~27 |
| `package.json` | Dependencies and scripts | ~28 |
| `test-backend.js` | Manual test script (posts test image to API) | ~50 |
| `.env.local` | Environment variables (OPENAI_API_KEY) | ~1 |

## Quick-Reference: Common Error Patterns

| Symptom | Likely Cause | Look At |
|---------|-------------|---------|
| "OPENAI_API_KEY not set" | Missing .env.local | `.env.local` |
| "mask" error from OpenAI | API requires mask param | `route.ts:157-171` |
| FFmpeg "not found" | ffmpeg-static not installed | `package.json`, `route.ts:16-18` |
| ZIP download is 0 bytes | Archive finalized before files added | `route.ts:201-234` |
| "Could not determine image dimensions" | ffprobe failed on input | `route.ts:86-96` |
| TypeScript build errors | Missing @types or @ts-ignore gaps | `errors.txt`, `route.ts` |
| Timeout after 800s | Too many iterations + slow API | `route.ts:14` (maxDuration) |
| "No image data returned" | OpenAI returned empty response | `route.ts:174` |
| Status stuck on "Processing..." | Frontend fetch never resolves | `page.tsx:22-25` |
| Memory crash on server | Too many large PNGs in /tmp | `route.ts:60` (workDir) |
