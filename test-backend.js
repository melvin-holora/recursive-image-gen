
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// 1. Setup FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

console.log("Generating test image...");

// 2. Generate dummy image
// We'll just create a simple PNG buffer manually or use ffmpeg
const testImagePath = path.join(__dirname, 'test_input.png');

new Promise((resolve, reject) => {
    ffmpeg()
        .input('color=c=red:s=1024x1024')
        .inputFormat('lavfi')
        .output(testImagePath)
        .frames(1)
        .on('end', resolve)
        .on('error', reject)
        .run();
}).then(async () => {
    console.log("Image generated at", testImagePath);

    // 3. Upload to API
    console.log("Sending request to http://localhost:3001/api/generate...");

    const formData = new FormData();
    const fileBuffer = fs.readFileSync(testImagePath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    formData.append('image', blob, 'test_input.png');
    formData.append('iterations', '1');

    try {
        const res = await fetch('http://localhost:3001/api/generate', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Server responded with ${res.status}: ${text}`);
        }

        console.log("Response OK! Downloading ZIP...");
        const buffer = await res.arrayBuffer();
        fs.writeFileSync('test_output.zip', Buffer.from(buffer));
        console.log("SUCCESS: test_output.zip created.");

    } catch (err) {
        console.error("FAILED:", err.message);
    }

}).catch(err => {
    console.error("FFmpeg generation failed:", err);
});
