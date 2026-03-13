
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import archiver from "archiver";
import { Readable } from "stream";

// Configuration
export const runtime = "nodejs";
export const maxDuration = 800;

if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic);
}

// Promisified fs functions for cleaner async/await
const writeFile = fs.promises.writeFile;
const readFile = fs.promises.readFile;
const mkdir = fs.promises.mkdir;
const rm = fs.promises.rm;
const readdir = fs.promises.readdir;

// Allowed MIME types for upload validation
const ALLOWED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
]);

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
// JPEG magic bytes: FF D8 FF
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// WebP magic bytes: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

function validateMagicBytes(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;
    const matchesPng = PNG_MAGIC.every((b, i) => buffer[i] === b);
    const matchesJpeg = JPEG_MAGIC.every((b, i) => buffer[i] === b);
    const matchesWebp =
        RIFF_MAGIC.every((b, i) => buffer[i] === b) &&
        WEBP_MAGIC.every((b, i) => buffer[i + 8] === b);
    return matchesPng || matchesJpeg || matchesWebp;
}

export async function POST(req: NextRequest) {
    let workDir = "";

    try {
        const formData = await req.formData();
        const file = formData.get("image") as File;
        const iterationsInput = formData.get("iterations");
        const customPrompt = formData.get("prompt") as string | null;

        // Clamp iterations: 1 to 99
        let iterations = iterationsInput ? parseInt(iterationsInput as string) : 99;
        if (isNaN(iterations)) iterations = 99;
        if (iterations < 1) iterations = 1;
        if (iterations > 99) iterations = 99;

        if (!file) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        // Validate MIME type
        if (!ALLOWED_MIME_TYPES.has(file.type)) {
            return NextResponse.json({ error: "Invalid file type. Allowed: PNG, JPG, WebP." }, { status: 400 });
        }

        // Hardening: Max upload size (10MB)
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large. Max 10MB." }, { status: 400 });
        }

        // Validate magic bytes
        const uploadBuffer = Buffer.from(await file.arrayBuffer());
        if (!validateMagicBytes(uploadBuffer)) {
            return NextResponse.json({ error: "File content does not match a valid image format." }, { status: 400 });
        }

        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
        }

        const openai = new OpenAI({ apiKey: openaiApiKey });

        // Determine the generation prompt
        const prompt = (customPrompt && customPrompt.trim())
            ? customPrompt.trim().slice(0, 500)
            : "Recreate this image as you see it.";

        // A. Use Vercel-safe temp directory
        const timestamp = Date.now();
        workDir = path.join(os.tmpdir(), `job-${timestamp}`);
        await mkdir(workDir, { recursive: true });

        // B. Handle Upload and Convert to PNG
        // Save original upload with correct extension (Whitelist approach)
        let uploadExt = "png"; // Default
        if (file.type === "image/png") uploadExt = "png";
        else if (file.type === "image/jpeg" || file.type === "image/jpg") uploadExt = "jpg";
        else if (file.type === "image/webp") uploadExt = "webp";

        const uploadPath = path.join(workDir, `upload.${uploadExt}`);
        await writeFile(uploadPath, uploadBuffer);

        // Convert to strict step-000.png with overwrite flag
        const step0Path = path.join(workDir, "step-000.png");
        await new Promise<void>((resolve, reject) => {
            ffmpeg(uploadPath)
                .outputOptions(["-y"]) // Force overwrite
                .output(step0Path)
                .on("end", resolve)
                .on("error", reject)
                .run();
        });

        // C. Orientation Lock (Probe step-000.png)
        const metadata = await new Promise<{ streams: Array<{ width?: number; height?: number }> }>((resolve, reject) => {
            ffmpeg.ffprobe(step0Path, (err: Error | null, data: { streams: Array<{ width?: number; height?: number }> }) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        const videoStream = metadata.streams.find((s) => s.width && s.height);
        if (!videoStream) {
            throw new Error("Could not determine image dimensions");
        }

        const width = videoStream.width!;
        const height = videoStream.height!;
        const ratio = width / height;

        let size: "1024x1024" | "1536x1024" | "1024x1536";
        if (ratio >= 0.9 && ratio <= 1.1) {
            size = "1024x1024";
        } else if (ratio > 1.1) {
            size = "1536x1024";
        } else {
            size = "1024x1536";
        }

        // Mask setup (Lazy creation if needed)
        let maskPath: string | null = null;
        const ensureMask = async (): Promise<string> => {
            if (maskPath) return maskPath;
            const mPath = path.join(workDir, "mask.png");
            // Create transparent mask matching the TARGET size
            const [w, h] = size.split("x");
            await new Promise<void>((resolve, reject) => {
                ffmpeg()
                    .input(`color=c=black@0.0:s=${w}x${h}`)
                    .inputFormat("lavfi")
                    .output(mPath)
                    .frames(1)
                    .on("end", resolve)
                    .on("error", reject)
                    .run();
            });
            maskPath = mPath;
            return mPath;
        };

        // D. Recursive Loop
        // step-000 is ready. We generate 1..iterations (max 99).
        let currentImagePath = step0Path;

        for (let i = 1; i <= iterations; i++) {
            console.log(`Step ${i}/${iterations}: generating...`);
            const imageStream = fs.createReadStream(currentImagePath);

            try {
                // E. OpenAI Call
                const params: Record<string, unknown> = {
                    model: "gpt-image-1",
                    image: imageStream,
                    prompt,
                    n: 1,
                    size: size,
                    response_format: "b64_json"
                };

                let b64: string | undefined;

                try {
                    const response = await openai.images.edit(params as Parameters<typeof openai.images.edit>[0]);
                    b64 = (response as unknown as { data: Array<{ b64_json?: string }> }).data[0]?.b64_json;
                } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    // Fallback for mask requirement
                    if (errMsg.toLowerCase().includes("mask")) {
                        console.log(`Step ${i}: Mask required, retrying with transparent mask.`);
                        const mPath = await ensureMask();
                        const maskStream = fs.createReadStream(mPath);
                        const retryParams = {
                            ...params,
                            mask: maskStream,
                            image: fs.createReadStream(currentImagePath), // Re-create consumed stream
                        };

                        const retryResponse = await openai.images.edit(retryParams as Parameters<typeof openai.images.edit>[0]);
                        b64 = (retryResponse as unknown as { data: Array<{ b64_json?: string }> }).data[0]?.b64_json;
                    } else {
                        throw err;
                    }
                }

                if (!b64) throw new Error("No image data returned from OpenAI");

                const nextStepFilename = `step-${String(i).padStart(3, "0")}.png`;
                const nextStepPath = path.join(workDir, nextStepFilename);
                await writeFile(nextStepPath, Buffer.from(b64, "base64"));

                currentImagePath = nextStepPath;

            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : String(error);
                console.error(`Error at step ${i}:`, errMsg);
                throw error; // Fail fast
            }
        }

        // F. Video Generation
        const videoPath = path.join(workDir, "output.mp4");
        await new Promise<void>((resolve, reject) => {
            ffmpeg()
                // Force start at 0 to include original
                .input(path.join(workDir, "step-%03d.png"))
                .inputOptions(["-framerate 2", "-start_number 0"])
                .outputOptions("-c:v libx264", "-pix_fmt yuv420p", "-r 30") // Force output 30fps
                .save(videoPath)
                .on("end", resolve)
                .on("error", reject);
        });

        // G. ZIP Response with Archiver Streaming
        const archive = archiver("zip", { zlib: { level: 9 } });

        // Add files
        const files = await readdir(workDir);
        for (const fileName of files) {
            if ((fileName.startsWith("step-") && fileName.endsWith(".png")) || fileName === "output.mp4") {
                archive.file(path.join(workDir, fileName), { name: fileName });
            }
        }

        // Cleanup temp dir after archive stream is fully consumed
        const cleanupWorkDir = () => {
            rm(workDir, { recursive: true, force: true }).catch(console.error);
        };

        archive.on("end", () => {
            cleanupWorkDir();
        });

        archive.on("error", (err: Error) => {
            console.error("Archive error:", err);
            cleanupWorkDir();
        });

        archive.finalize();

        const webStream = Readable.toWeb(archive as unknown as Readable);

        return new NextResponse(webStream as ReadableStream, {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="evolution-${timestamp}.zip"`
            }
        });

    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : "Internal Server Error";
        console.error("Pipeline failed:", errMsg);
        if (workDir) {
            await rm(workDir, { recursive: true, force: true }).catch(console.error);
        }
        return NextResponse.json({ error: errMsg }, { status: 500 });
    }
}
