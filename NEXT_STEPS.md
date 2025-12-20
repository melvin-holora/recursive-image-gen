
# Next Steps: Configuration

> [!IMPORTANT]  
> The `OPENAI_API_KEY` is required for this application to work.

## 1. Create Configuration File
Create a file named `.env.local` in the **project root folder**:
`C:\Users\smoke\.gemini\antigravity\scratch\recursive-image-gen\.env.local`

## 2. Add API Key
Copy and paste this exact line into the file (no quotes around the key):
```env
OPENAI_API_KEY=sk-proj-YOUR_ACTUAL_KEY_HERE...
```

## 3. Restart Server
After creating or editing `.env.local`, you **MUST** restart the dev server for changes to take effect:
1. Stop the server (`Ctrl+C` in terminal).
2. Run `npm run dev -- -p 3001`.
