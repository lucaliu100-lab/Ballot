/**
 * Frame Extractor Module
 * 
 * Uses FFmpeg to extract frames from video files for analysis.
 * Extracts a sample of frames (e.g., 1 frame every 2-3 seconds, max 10 frames)
 * to provide representative snapshots of the speaker's body language.
 * 
 * REQUIREMENTS:
 * FFmpeg must be installed:
 * - macOS: brew install ffmpeg
 * - Ubuntu: sudo apt install ffmpeg
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

// ===========================================
// CONFIGURATION
// ===========================================

// Directory for temporary frame files
const TEMP_FRAMES_DIR = path.join(__dirname, '../temp/frames');

// Maximum number of frames to extract (to limit API costs and processing time)
const MAX_FRAMES = 10;

// Target interval between frames (in seconds)
const FRAME_INTERVAL = 2;

// Ensure temp directory exists
if (!fs.existsSync(TEMP_FRAMES_DIR)) {
  fs.mkdirSync(TEMP_FRAMES_DIR, { recursive: true });
}

// ===========================================
// TYPES
// ===========================================

interface FrameExtractionResult {
  success: boolean;
  frames?: Buffer[];      // Array of frame image buffers
  frameCount?: number;    // Number of frames extracted
  error?: string;
}

interface VideoInfo {
  duration: number;       // Video duration in seconds
  width: number;
  height: number;
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

/**
 * Get video duration and dimensions using ffprobe
 * Handles cases where duration might be undefined or a string (common with WebM)
 */
function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      // Parse duration safely - it might be undefined, string, or number
      let duration = 0;
      if (metadata.format.duration !== undefined) {
        duration = typeof metadata.format.duration === 'string' 
          ? parseFloat(metadata.format.duration) 
          : metadata.format.duration;
      }
      
      // If duration is still 0 or NaN, try to get it from the video stream
      if (!duration || isNaN(duration)) {
        if (videoStream.duration !== undefined) {
          duration = typeof videoStream.duration === 'string'
            ? parseFloat(videoStream.duration as string)
            : (videoStream.duration as number);
        }
      }
      
      // Default to 10 seconds if we still can't determine duration
      if (!duration || isNaN(duration) || duration <= 0) {
        console.log('   Warning: Could not determine video duration, defaulting to 10 seconds');
        duration = 10;
      }

      resolve({
        duration,
        width: videoStream.width || 640,
        height: videoStream.height || 480,
      });
    });
  });
}

/**
 * Clean up temporary frame files
 */
function cleanupFrameFiles(sessionId: string): void {
  const pattern = path.join(TEMP_FRAMES_DIR, `${sessionId}-frame-*.jpg`);
  const files = fs.readdirSync(TEMP_FRAMES_DIR)
    .filter(f => f.startsWith(`${sessionId}-frame-`));
  
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(TEMP_FRAMES_DIR, file));
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ===========================================
// MAIN EXTRACTION FUNCTION
// ===========================================

/**
 * Extract frames from a video file for body language analysis
 * 
 * @param videoPath - Path to the video file
 * @param sessionId - Unique session ID (used for temp file naming)
 * @returns Promise with array of frame buffers or error
 * 
 * EXAMPLE USAGE:
 * ```typescript
 * const result = await extractFramesFromVideo('/path/to/video.webm', 'abc123');
 * if (result.success) {
 *   console.log('Extracted', result.frameCount, 'frames');
 *   // result.frames contains the Buffer array
 * }
 * ```
 */
export async function extractFramesFromVideo(
  videoPath: string,
  sessionId: string
): Promise<FrameExtractionResult> {
  // Validate video file exists
  if (!fs.existsSync(videoPath)) {
    return {
      success: false,
      error: `Video file not found: ${videoPath}`,
    };
  }

  console.log('\n🎬 Extracting frames from video...');
  console.log('   Video path:', videoPath);
  console.log('   Session ID:', sessionId);

  try {
    // Step 1: Get video information
    console.log('   Getting video info...');
    const videoInfo = await getVideoInfo(videoPath);
    console.log('   Duration:', Number(videoInfo.duration).toFixed(1), 'seconds');
    console.log('   Resolution:', `${videoInfo.width}x${videoInfo.height}`);

    // Step 2: Calculate frame extraction points
    // We want ~1 frame every FRAME_INTERVAL seconds, up to MAX_FRAMES
    const duration = videoInfo.duration;
    const idealFrameCount = Math.floor(duration / FRAME_INTERVAL);
    const frameCount = Math.min(Math.max(idealFrameCount, 1), MAX_FRAMES);
    
    // Calculate the actual interval to spread frames evenly
    const actualInterval = duration / frameCount;
    
    console.log('   Target frames:', frameCount);
    console.log('   Interval:', Number(actualInterval).toFixed(1), 'seconds');

    // Step 3: Extract frames using FFmpeg
    const framePromises: Promise<Buffer>[] = [];
    
    for (let i = 0; i < frameCount; i++) {
      // Calculate timestamp for this frame
      const timestamp = (i * actualInterval) + (actualInterval / 2);
      const outputPath = path.join(TEMP_FRAMES_DIR, `${sessionId}-frame-${i}.jpg`);
      
      framePromises.push(
        extractSingleFrame(videoPath, timestamp, outputPath)
      );
    }

    // Wait for all frames to be extracted
    const frames = await Promise.all(framePromises);

    // Filter out any failed extractions (empty buffers)
    const validFrames = frames.filter(f => f.length > 0);

    console.log('✅ Frame extraction complete!');
    console.log('   Extracted:', validFrames.length, 'frames');

    // Clean up temp files
    cleanupFrameFiles(sessionId);

    if (validFrames.length === 0) {
      return {
        success: false,
        error: 'Failed to extract any frames from the video',
      };
    }

    return {
      success: true,
      frames: validFrames,
      frameCount: validFrames.length,
    };

  } catch (error) {
    // Clean up on error
    cleanupFrameFiles(sessionId);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Frame extraction failed:', errorMessage);
    
    return {
      success: false,
      error: `Frame extraction failed: ${errorMessage}`,
    };
  }
}

/**
 * Extract a single frame at a specific timestamp
 */
function extractSingleFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<Buffer> {
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      // Seek to the timestamp
      .seekInput(timestamp)
      // Take one frame
      .frames(1)
      // Scale down for faster processing (max 720p)
      .size('?x720')
      // Output as JPEG
      .format('image2')
      .output(outputPath)
      // Event handlers
      .on('end', () => {
        try {
          // Read the frame file into a buffer
          const buffer = fs.readFileSync(outputPath);
          resolve(buffer);
        } catch {
          // Return empty buffer on read error
          resolve(Buffer.alloc(0));
        }
      })
      .on('error', (err) => {
        console.log(`   Warning: Failed to extract frame at ${Number(timestamp).toFixed(1)}s:`, err.message);
        resolve(Buffer.alloc(0));
      })
      // Run the extraction
      .run();
  });
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Check if FFmpeg is available for frame extraction
 */
export function checkFfmpegForFrames(): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        console.error('❌ FFmpeg is not available for frame extraction');
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}



