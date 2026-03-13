
"use client";

import { useState, useRef, type FormEvent, type ChangeEvent } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [preview, setPreview] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPreview(url);
    } else {
      setPreview(null);
    }
  }

  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus("Starting process...");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData(e.currentTarget);

      setStatus("Uploading and generating images (this may take a few minutes)...");

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMessage = response.statusText;
        try {
          const json = await response.json();
          if (json.error) errMessage = json.error;
        } catch {
          // Ignore json parse error
        }
        throw new Error(errMessage);
      }

      setStatus("Downloading ZIP...");

      // Handle Filename from Content-Disposition
      let filename = `evolution-${Date.now()}.zip`;
      const disposition = response.headers.get("Content-Disposition");
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Cleanup DOM and URL
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setStatus("Complete!");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("Cancelled");
        setError(null);
      } else {
        const errMsg = err instanceof Error ? err.message : "An unexpected error occurred";
        setError(errMsg);
        setStatus("Failed");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-black text-white font-sans">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-xl shadow-2xl">
        <h1 className="text-2xl font-bold mb-2 tracking-tight text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Recursive Image Gen
        </h1>
        <p className="text-zinc-400 text-sm text-center mb-8">
          Upload an image. Watch it evolve over up to 99 frames.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6" suppressHydrationWarning>
          <div className="space-y-2">
            <label htmlFor="image" className="block text-xs uppercase tracking-wider text-zinc-500 font-semibold">
              Source Image
            </label>
            <input
              id="image"
              name="image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              onChange={handleImageChange}
              className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer border border-zinc-800 rounded-lg p-2"
            />
            {preview && (
              <div className="mt-2 rounded-md overflow-hidden border border-zinc-800">
                <img
                  src={preview}
                  alt="Preview"
                  className="w-full h-48 object-contain bg-zinc-950"
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="iterations" className="block text-xs uppercase tracking-wider text-zinc-500 font-semibold">
              Iterations
            </label>
            <input
              id="iterations"
              name="iterations"
              type="number"
              defaultValue={99}
              suppressHydrationWarning
              min={1}
              max={99}
              className="w-full bg-black border border-zinc-800 text-zinc-300 rounded-md p-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="prompt" className="block text-xs uppercase tracking-wider text-zinc-500 font-semibold">
              Prompt <span className="text-zinc-600 normal-case">(optional)</span>
            </label>
            <input
              id="prompt"
              name="prompt"
              type="text"
              placeholder="Recreate this image as you see it."
              maxLength={500}
              className="w-full bg-black border border-zinc-800 text-zinc-300 rounded-md p-2 text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder:text-zinc-700"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 bg-white text-black font-bold rounded-md hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              {loading ? "Processing..." : "Start Evolution"}
            </button>
            {loading && (
              <button
                type="button"
                onClick={handleCancel}
                className="py-3 px-4 bg-red-900/50 text-red-300 font-bold rounded-md hover:bg-red-900 transition-all active:scale-95"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {status && (
          <div className="mt-6 p-4 rounded-md bg-zinc-950 border border-zinc-900">
            <p className={`text-sm text-center ${
              status === "Complete!" || status === "Cancelled"
                ? "text-zinc-300"
                : "text-zinc-300 animate-pulse"
            }`}>
              {status}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 rounded-md bg-red-950/20 border border-red-900/50">
            <p className="text-red-400 text-sm text-center">{error}</p>
          </div>
        )}
      </div>
    </main>
  );
}
