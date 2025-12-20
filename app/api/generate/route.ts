
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

export async function POST(req: NextRequest) {
    let workDir = "";

    try {
        const formData = await req.formData();
        const file = formData.get("image") as File;
        const iterationsInput = formData.get("iterations");

        // Clamp iterations: 1 to 99
        let iterations = iterationsInput ? parseInt(iterationsInput as string) : 99;
        if (isNaN(iterations)) iterations = 99;
        if (iterations < 1) iterations = 1;
        if (iterations > 99) iterations = 99;

        if (!file) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        // Hardening: Max upload size (10MB)
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large. Max 10MB." }, { status: 400 });
        }

        const openaiApiKey = process.env.OPENAI_API_KEY;
        console.log("DEBUG: API Key present:", !!openaiApiKey, "First 7:", openaiApiKey ? openaiApiKey.substring(0, 7) : "N/A");
        if (!openaiApiKey) {
            return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
        }

        const openai = new OpenAI({ apiKey: openaiApiKey });

        // A. Use Vercel-safe temp directory
        const timestamp = Date.now();
        workDir = path.join(os.tmpdir(), `job-${timestamp}`);
        await mkdir(workDir, { recursive: true });

        // B. Handle Upload and Convert to PNG
        // Save original upload with correct extension (Whitelist approach)
        const uploadBuffer = await file.arrayBuffer();
        let uploadExt = "png"; // Default
        if (file.type === "image/png") uploadExt = "png";
        else if (file.type === "image/jpeg" || file.type === "image/jpg") uploadExt = "jpg";
        else if (file.type === "image/webp") uploadExt = "webp";

        const uploadPath = path.join(workDir, `upload.${uploadExt}`);
        await writeFile(uploadPath, Buffer.from(uploadBuffer));

        // Convert to strict step-000.png with overwrite flag
        const step0Path = path.join(workDir, "step-000.png");
        await new Promise((resolve, reject) => {
            ffmpeg(uploadPath)
                .outputOptions(["-y"]) // Force overwrite
                .output(step0Path)
                .on("end", resolve)
                .on("error", reject)
                .run();
        });

        // C. Orientation Lock (Probe step-000.png)
        const metadata: any = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(step0Path, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });

        const stream = metadata.streams.find((s: any) => s.width && s.height);
        if (!stream) {
            throw new Error("Could not determine image dimensions");
        }

        const width = stream.width;
        const height = stream.height;
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
        const ensureMask = async () => {
            if (maskPath) return maskPath;
            const mPath = path.join(workDir, "mask.png");
            // Create transparent mask matching the TARGET size
            const [w, h] = size.split("x");
            await new Promise((resolve, reject) => {
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
            const imageStream = fs.createReadStream(currentImagePath);

            try {
                // E. OpenAI Call
                const params: any = {
                    model: "gpt-image-1",
                    image: imageStream,
                    prompt: "Recreate this image as you see it.",
                    n: 1,
                    size: size,
                    response_format: "b64_json"
                };

                let b64: string | undefined;

                try {
                    // @ts-ignore
                    const response = await openai.images.edit(params);
                    // @ts-ignore
                    b64 = response.data[0].b64_json;
                } catch (err: any) {
                    // Fallback for mask requirement
                    if (err.message && err.message.toLowerCase().includes("mask")) {
                        console.log(`Step ${i}: Mask required, retrying with transparent mask.`);
                        const mPath = await ensureMask();
                        const maskStream = fs.createReadStream(mPath);
                        const retryParams = { ...params, mask: maskStream, image: fs.createReadStream(currentImagePath) }; // Re-create stream

                        // @ts-ignore
                        const retryResponse = await openai.images.edit(retryParams);
                        // @ts-ignore
                        b64 = retryResponse.data[0].b64_json;
                    } else {
                        throw err;
                    }
                }

                if (!b64) throw new Error("No image data returned from OpenAI");

                const nextStepFilename = `step-${String(i).padStart(3, "0")}.png`;
                const nextStepPath = path.join(workDir, nextStepFilename);
                await writeFile(nextStepPath, Buffer.from(b64, "base64"));

                currentImagePath = nextStepPath;

            } catch (error: any) {
                console.error(`Error at step ${i}:`, error);
                throw error; // Fail fast
            }
        }

        // F. Video Generation
        const videoPath = path.join(workDir, "output.mp4");
        await new Promise((resolve, reject) => {
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

        // Prepare stream cleanup on 'close'
        archive.on("close", () => {
            setTimeout(() => {
                rm(workDir, { recursive: true, force: true }).catch(console.error);
            }, 1000);
        });

        archive.on("error", (err) => {
            console.error("Archive error:", err);
            rm(workDir, { recursive: true, force: true }).catch(console.error);
        });

        archive.finalize();

        const webStream = Readable.toWeb(archive as Readable);

        return new NextResponse(webStream as any, {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="evolution-${timestamp}.zip"`
            }
        });

    } catch (error: any) {
        console.error("Pipeline failed:", error);
        if (workDir) {
            await rm(workDir, { recursive: true, force: true }).catch(console.error);
        }
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
