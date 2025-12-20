
"use client";

import { useState, type FormEvent } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStatus("Starting process...");

    try {
      const formData = new FormData(e.currentTarget);

      setStatus("Uploading and Generating images (this may take a few minutes)...");

      const response = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errMessage = response.statusText;
        try {
          const json = await response.json();
          if (json.error) errMessage = json.error;
        } catch (e) {
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
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
      setStatus("Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-black text-white font-sans">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-xl shadow-2xl">
        <h1 className="text-2xl font-bold mb-2 tracking-tight text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Recursive Image Gen
        </h1>
        <p className="text-zinc-400 text-sm text-center mb-8">
          Upload an image. Watch it evolve 100 frames.
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
              accept="image/*"
              required
              className="w-full text-sm text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer border border-zinc-800 rounded-lg p-2"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="iterations" className="block text-xs uppercase tracking-wider text-zinc-500 font-semibold">
              Iterations (Dev/Test)
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

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-white text-black font-bold rounded-md hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            {loading ? "Processing..." : "Start Evolution"}
          </button>
        </form>

        {status && (
          <div className="mt-6 p-4 rounded-md bg-zinc-950 border border-zinc-900">
            <p className="text-zinc-300 text-sm animate-pulse text-center">{status}</p>
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
