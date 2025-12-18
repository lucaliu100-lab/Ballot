/**
 * Audio Extractor Module
 * 
 * Uses FFmpeg to extract audio from video files.
 * This is needed because we record video but only need audio for transcription.
 * 
 * REQUIREMENTS:
 * =============
 * FFmpeg must be installed on your system:
 * 
 * macOS:   brew install ffmpeg
 * Ubuntu:  sudo apt install ffmpeg
 * Windows: Download from https://ffmpeg.org/download.html
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

// ===========================================
// CONFIGURATION
// ===========================================

// Directory for temporary audio files
const TEMP_DIR = path.join(__dirname, '../temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ===========================================
// TYPES
// ===========================================

interface ExtractionResult {
  success: boolean;
  audioPath?: string;
  error?: string;
}

// ===========================================
// MAIN EXTRACTION FUNCTION
// ===========================================

/**
 * Extract audio from a video file
 * 
 * @param videoPath - Path to the video file
 * @param sessionId - Session ID (used for naming the output file)
 * @returns Promise with the path to the extracted audio file
 * 
 * EXAMPLE USAGE:
 * ```typescript
 * const result = await extractAudioFromVideo('/path/to/video.webm', 'abc123');
 * if (result.success) {
 *   console.log('Audio extracted to:', result.audioPath);
 * }
 * ```
 */
export function extractAudioFromVideo(
  videoPath: string,
  sessionId: string
): Promise<ExtractionResult> {
  return new Promise((resolve) => {
    // Check if video file exists
    if (!fs.existsSync(videoPath)) {
      resolve({
        success: false,
        error: `Video file not found: ${videoPath}`,
      });
      return;
    }

    // Create output path for the audio file
    // Using .wav format for best compatibility with speech recognition
    const audioPath = path.join(TEMP_DIR, `audio-${sessionId}.wav`);

    console.log('🎵 Extracting audio from video...');
    console.log('   Input:', videoPath);
    console.log('   Output:', audioPath);

    // Use FFmpeg to extract audio
    ffmpeg(videoPath)
      // Audio settings optimized for speech recognition
      .audioChannels(1)        // Mono audio (speech recognition works better with mono)
      .audioFrequency(16000)   // 16kHz sample rate (standard for speech recognition)
      .audioCodec('pcm_s16le') // WAV format with 16-bit PCM
      .format('wav')
      
      // Output file path
      .output(audioPath)
      
      // Event handlers
      .on('start', (commandLine) => {
        console.log('   FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`   Progress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log('✅ Audio extraction complete!');
        resolve({
          success: true,
          audioPath,
        });
      })
      .on('error', (err) => {
        console.error('❌ FFmpeg error:', err.message);
        resolve({
          success: false,
          error: `FFmpeg error: ${err.message}`,
        });
      })
      
      // Start the extraction
      .run();
  });
}

// ===========================================
// CLEANUP FUNCTION
// ===========================================

/**
 * Delete a temporary audio file after processing
 * 
 * @param audioPath - Path to the audio file to delete
 */
export function cleanupTempAudio(audioPath: string): void {
  try {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
      console.log('🗑️ Cleaned up temp audio file:', audioPath);
    }
  } catch (error) {
    console.error('Warning: Failed to cleanup temp file:', audioPath);
  }
}

// ===========================================
// CHECK FFMPEG AVAILABILITY
// ===========================================

/**
 * Check if FFmpeg is available on the system
 * Returns a promise that resolves to true if FFmpeg is available
 */
export function checkFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        console.error('❌ FFmpeg is not available:', err.message);
        resolve(false);
      } else {
        console.log('✅ FFmpeg is available');
        resolve(true);
      }
    });
  });
}




