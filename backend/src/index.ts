/**
 * Backend Server for Speech Practice App
 * 
 * This Express server handles:
 * - /api/ping - Health check endpoint
 * - /api/start-round - Returns theme and quotes for practice
 * - /api/upload - Accepts video recordings from users
 * - /api/process-audio - Transcribes uploaded recordings using Qwen2-Audio
 * - /api/analyze-video - Analyzes body language using Qwen2.5-VL
 * - /api/generate-feedback - Generates debate judge feedback using DeepSeek
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Import our custom modules for audio processing
import { transcribeAudio, isQwenAudioConfigured, getQwenAudioStatus } from './qwenAudioClient';
import { extractAudioFromVideo, cleanupTempAudio, checkFfmpegAvailable } from './audioExtractor';

// Import our custom modules for video analysis
import { analyzeBodyLanguageFromFrames, isQwenVLConfigured, getQwenVLStatus } from './qwenVideoClient';
import { extractFramesFromVideo } from './frameExtractor';

// Import DeepSeek client for feedback generation
import { generateDebateFeedback, isDeepSeekConfigured, getDeepSeekStatus } from './deepseekClient';

// Load environment variables
// Try backend/.env first, then root .env for local development
dotenv.config(); // This loads from process.cwd()/.env (works on Render)
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Fallback for local dev

const app = express();
const PORT = process.env.PORT || 3001;

// ===========================================
// IN-MEMORY STORAGE
// ===========================================

/**
 * Store mapping of sessionId -> session data
 * In a real app, this would be stored in a database
 */
interface SessionData {
  filePath: string;
  uploadedAt: Date;
  theme?: string;
  quote?: string;
}

const sessionStorage: Map<string, SessionData> = new Map();

// ===========================================
// MIDDLEWARE SETUP
// ===========================================

// Enable CORS so frontend can call our API
// Configure for cross-origin requests from Vercel
app.use(cors({
  origin: true, // Allow all origins (you can restrict to your Vercel URL later)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

// Parse JSON request bodies
app.use(express.json());

// ===========================================
// FILE UPLOAD CONFIGURATION (Multer)
// ===========================================

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename: timestamp + uuid + original extension
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname) || '.webm';
    cb(null, `recording-${Date.now()}-${uniqueId}${extension}`);
  },
});

// Create multer instance with our storage config
const upload = multer({ 
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
});

// ===========================================
// API ROUTES
// ===========================================

/**
 * GET /api/ping
 * Simple health check endpoint
 */
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * GET /api/status
 * Check if all services are configured properly
 */
app.get('/api/status', async (req, res) => {
  const qwenAudioStatus = getQwenAudioStatus();
  const qwenVLStatus = getQwenVLStatus();
  const deepseekStatus = getDeepSeekStatus();
  const ffmpegAvailable = await checkFfmpegAvailable();
  
  res.json({
    qwenAudio: qwenAudioStatus,
    qwenVL: qwenVLStatus,
    deepseek: deepseekStatus,
    ffmpeg: ffmpegAvailable,
    sessionsStored: sessionStorage.size,
  });
});

/**
 * Themes and quotes database
 * Each theme has 3 arguable quotes by famous people with multiple interpretations
 */
const THEMES_DATABASE = [
  {
    theme: 'Freedom',
    quotes: [
      '"The only way to deal with an unfree world is to become so absolutely free that your very existence is an act of rebellion." — Albert Camus',
      '"Man is condemned to be free; because once thrown into the world, he is responsible for everything he does." — Jean-Paul Sartre',
      '"Those who would give up essential Liberty, to purchase a little temporary Safety, deserve neither Liberty nor Safety." — Benjamin Franklin',
    ],
  },
  {
    theme: 'Power',
    quotes: [
      '"Nearly all men can stand adversity, but if you want to test a man\'s character, give him power." — Abraham Lincoln',
      '"Power tends to corrupt, and absolute power corrupts absolutely." — Lord Acton',
      '"The measure of a man is what he does with power." — Plato',
    ],
  },
  {
    theme: 'Truth',
    quotes: [
      '"The truth is rarely pure and never simple." — Oscar Wilde',
      '"In a time of deceit, telling the truth is a revolutionary act." — George Orwell',
      '"There are no facts, only interpretations." — Friedrich Nietzsche',
    ],
  },
  {
    theme: 'Justice',
    quotes: [
      '"Injustice anywhere is a threat to justice everywhere." — Martin Luther King Jr.',
      '"The arc of the moral universe is long, but it bends toward justice." — Theodore Parker',
      '"If you want peace, work for justice." — Pope Paul VI',
    ],
  },
  {
    theme: 'Success',
    quotes: [
      '"It is not enough to succeed. Others must fail." — Gore Vidal',
      '"Success is not final, failure is not fatal: it is the courage to continue that counts." — Winston Churchill',
      '"The only place where success comes before work is in the dictionary." — Vidal Sassoon',
    ],
  },
  {
    theme: 'Knowledge',
    quotes: [
      '"The more I learn, the more I realize how much I don\'t know." — Albert Einstein',
      '"Knowledge is power, but enthusiasm pulls the switch." — Ivern Ball',
      '"Real knowledge is to know the extent of one\'s ignorance." — Confucius',
    ],
  },
  {
    theme: 'Change',
    quotes: [
      '"The only constant in life is change." — Heraclitus',
      '"Be the change you wish to see in the world." — Mahatma Gandhi',
      '"Progress is impossible without change, and those who cannot change their minds cannot change anything." — George Bernard Shaw',
    ],
  },
  {
    theme: 'Courage',
    quotes: [
      '"Courage is not the absence of fear, but rather the judgment that something else is more important than fear." — Ambrose Redmoon',
      '"You gain strength, courage, and confidence by every experience in which you really stop to look fear in the face." — Eleanor Roosevelt',
      '"It takes courage to grow up and become who you really are." — E.E. Cummings',
    ],
  },
  {
    theme: 'Happiness',
    quotes: [
      '"Happiness is not something ready-made. It comes from your own actions." — Dalai Lama',
      '"The secret of happiness is not in doing what one likes, but in liking what one does." — James M. Barrie',
      '"Happiness depends upon ourselves." — Aristotle',
    ],
  },
  {
    theme: 'Morality',
    quotes: [
      '"The only thing necessary for the triumph of evil is for good men to do nothing." — Edmund Burke',
      '"Morality is not the doctrine of how we may make ourselves happy, but of how we may make ourselves worthy of happiness." — Immanuel Kant',
      '"Right is right, even if everyone is against it, and wrong is wrong, even if everyone is for it." — William Penn',
    ],
  },
];

// Track which themes have been used in the session to avoid repeats
let usedThemeIndices: Set<number> = new Set();

/**
 * POST /api/start-round
 * Returns a random theme and 3 quotes for speech practice
 */
app.post('/api/start-round', (req, res) => {
  // Reset if all themes have been used
  if (usedThemeIndices.size >= THEMES_DATABASE.length) {
    usedThemeIndices.clear();
  }

  // Find an unused theme index
  let randomIndex: number;
  do {
    randomIndex = Math.floor(Math.random() * THEMES_DATABASE.length);
  } while (usedThemeIndices.has(randomIndex));

  usedThemeIndices.add(randomIndex);

  const roundData = THEMES_DATABASE[randomIndex];

  console.log('📚 Starting new round with theme:', roundData.theme);
  res.json(roundData);
});

/**
 * POST /api/upload
 * Accepts a video file upload (multipart/form-data)
 * 
 * Expected form field: "file" (the video blob)
 * Optional JSON fields in body: theme, quote
 * Returns: { sessionId, filePath, message }
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  // Check if file was provided
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Generate a unique session ID for this upload
  const sessionId = uuidv4();
  
  // Get the path where the file was saved
  const filePath = req.file.path;

  // Store the session data for later retrieval (including theme/quote if provided)
  sessionStorage.set(sessionId, {
    filePath,
    uploadedAt: new Date(),
    theme: req.body.theme,
    quote: req.body.quote,
  });

  console.log('📹 Video uploaded successfully!');
  console.log('   Session ID:', sessionId);
  console.log('   File path:', filePath);
  console.log('   File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('   Active sessions:', sessionStorage.size);

  // Return success response
  res.json({
    sessionId,
    filePath,
    message: 'Upload successful!',
  });
});

/**
 * POST /api/process-audio
 * Transcribe a previously uploaded video recording
 * 
 * Expected JSON body: { sessionId: string }
 * Returns: { transcript: string } or { error: string }
 */
app.post('/api/process-audio', async (req, res) => {
  const { sessionId } = req.body;

  // Validate input
  if (!sessionId) {
    return res.status(400).json({ 
      error: 'Missing sessionId in request body' 
    });
  }

  console.log('');
  console.log('🔄 Processing audio for session:', sessionId);

  // Look up the session data
  const sessionData = sessionStorage.get(sessionId);
  if (!sessionData) {
    console.error('❌ Session not found:', sessionId);
    return res.status(404).json({ 
      error: 'Session not found. The video may have been deleted or the session expired.' 
    });
  }

  const { filePath: videoPath } = sessionData;

  // Check if video file still exists
  if (!fs.existsSync(videoPath)) {
    console.error('❌ Video file not found:', videoPath);
    sessionStorage.delete(sessionId);
    return res.status(404).json({ 
      error: 'Video file not found. It may have been deleted.' 
    });
  }

  // Check if Qwen API is configured
  if (!isQwenAudioConfigured()) {
    console.warn('⚠️ Qwen Audio API not configured - returning mock transcript');
    return res.json({
      transcript: '[Mock Transcript] The Qwen Audio API is not configured yet. ' +
        'To enable real transcription, please add QWEN_AUDIO_API_KEY to your .env file.',
      isMock: true,
    });
  }

  try {
    // Step 1: Extract audio from video using FFmpeg
    console.log('Step 1/2: Extracting audio from video...');
    const extractionResult = await extractAudioFromVideo(videoPath, sessionId);
    
    if (!extractionResult.success || !extractionResult.audioPath) {
      return res.status(500).json({ 
        error: extractionResult.error || 'Failed to extract audio from video' 
      });
    }

    const audioPath = extractionResult.audioPath;

    // Step 2: Transcribe audio
    console.log('Step 2/2: Transcribing audio...');
    const transcriptionResult = await transcribeAudio(audioPath);

    // Clean up temporary audio file
    cleanupTempAudio(audioPath);

    if (!transcriptionResult.success) {
      return res.status(500).json({ 
        error: transcriptionResult.error || 'Failed to transcribe audio' 
      });
    }

    console.log('✅ Audio processing complete!');

    res.json({
      transcript: transcriptionResult.transcript,
      isMock: false,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Processing failed:', errorMessage);
    res.status(500).json({ 
      error: `Processing failed: ${errorMessage}` 
    });
  }
});

/**
 * POST /api/analyze-video
 * Analyze body language from a previously uploaded video
 * 
 * Expected JSON body: { sessionId: string }
 * Returns: { sessionId: string, videoSummary: string } or { error: string }
 */
app.post('/api/analyze-video', async (req, res) => {
  const { sessionId } = req.body;

  // Validate input
  if (!sessionId) {
    return res.status(400).json({ 
      error: 'Missing sessionId in request body' 
    });
  }

  console.log('');
  console.log('🎬 Analyzing video for session:', sessionId);

  // Look up the session data
  const sessionData = sessionStorage.get(sessionId);
  if (!sessionData) {
    console.error('❌ Session not found:', sessionId);
    return res.status(404).json({ 
      error: 'Session not found. The video may have been deleted or the session expired.' 
    });
  }

  const { filePath: videoPath } = sessionData;

  // Check if video file still exists
  if (!fs.existsSync(videoPath)) {
    console.error('❌ Video file not found:', videoPath);
    sessionStorage.delete(sessionId);
    return res.status(404).json({ 
      error: 'Video file not found. It may have been deleted.' 
    });
  }

  // Check if Qwen VL API is configured
  if (!isQwenVLConfigured()) {
    console.warn('⚠️ Qwen VL API not configured - returning mock analysis');
    return res.json({
      sessionId,
      videoSummary: '[Mock Analysis] The Qwen VL API is not configured yet. ' +
        'To enable real body language analysis, please add QWEN_VL_API_KEY to your .env file. ' +
        'The speaker appears engaged and maintains reasonable posture throughout the recording.',
      isMock: true,
    });
  }

  try {
    // Step 1: Extract frames from video using FFmpeg
    console.log('Step 1/2: Extracting frames from video...');
    const frameResult = await extractFramesFromVideo(videoPath, sessionId);
    
    if (!frameResult.success || !frameResult.frames) {
      return res.status(500).json({ 
        error: frameResult.error || 'Failed to extract frames from video' 
      });
    }

    console.log(`   Extracted ${frameResult.frameCount} frames`);

    // Step 2: Analyze frames with Qwen2.5-VL
    console.log('Step 2/2: Analyzing body language with Qwen2.5-VL...');
    const analysisResult = await analyzeBodyLanguageFromFrames(frameResult.frames);

    if (!analysisResult.success) {
      return res.status(500).json({ 
        error: analysisResult.error || 'Failed to analyze video' 
      });
    }

    console.log('✅ Video analysis complete!');

    // Return the analysis
    res.json({
      sessionId,
      videoSummary: analysisResult.summary,
      isMock: false,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Video analysis failed:', errorMessage);
    res.status(500).json({ 
      error: `Video analysis failed: ${errorMessage}` 
    });
  }
});

/**
 * Helper function to calculate speech statistics from transcript
 */
function calculateSpeechStats(transcript: string, durationSeconds?: number): {
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
} {
  // Count words (split by whitespace)
  const words = transcript.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  // Calculate words per minute (estimate 7 minutes if no duration provided)
  const duration = durationSeconds || 420; // default to 7 minutes
  const wordsPerMinute = Math.round((wordCount / duration) * 60);
  
  // Count filler words (case-insensitive)
  const fillerPatterns = [
    /\bum\b/gi,
    /\buh\b/gi,
    /\blike\b/gi,
    /\byou know\b/gi,
    /\bbasically\b/gi,
    /\bactually\b/gi,
    /\bso\b/gi,  // only at start of sentences ideally, but simple count for now
  ];
  
  let fillerCount = 0;
  for (const pattern of fillerPatterns) {
    const matches = transcript.match(pattern);
    if (matches) {
      fillerCount += matches.length;
    }
  }
  
  return { wordCount, wordsPerMinute, fillerCount };
}

/**
 * POST /api/generate-feedback
 * Generate comprehensive debate judge feedback using DeepSeek
 * 
 * Expected JSON body: {
 *   sessionId: string,
 *   transcript: string,
 *   bodyLanguageAnalysis: string,
 *   theme: string,
 *   quote: string,
 *   durationSeconds?: number
 * }
 * 
 * Returns: { feedback: {...} } or { error: string }
 */
app.post('/api/generate-feedback', async (req, res) => {
  const { sessionId, transcript, bodyLanguageAnalysis, theme, quote, durationSeconds } = req.body;

  // Validate required fields
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }
  if (!transcript) {
    return res.status(400).json({ error: 'Missing transcript' });
  }
  if (!bodyLanguageAnalysis) {
    return res.status(400).json({ error: 'Missing bodyLanguageAnalysis' });
  }

  console.log('');
  console.log('🎯 Generating debate feedback for session:', sessionId);

  // Calculate speech statistics from transcript
  const speechStats = calculateSpeechStats(transcript, durationSeconds);
  console.log('   Speech stats:', speechStats);

  // Check if DeepSeek API is configured
  if (!isDeepSeekConfigured()) {
    console.warn('⚠️ DeepSeek API not configured - returning mock feedback');
    return res.json({
      sessionId,
      feedback: {
        contentSummary: '[Mock] The speaker discussed their interpretation of the quote, connecting it to personal experiences and broader themes.',
        scores: {
          structure: 7,
          content: 6,
          delivery: 7,
        },
        strengths: [
          '[Mock] Clear opening that connected to the quote.',
          '[Mock] Good use of a personal example to illustrate your point.',
          '[Mock] Maintained eye contact with the camera throughout.',
        ],
        improvements: [
          '[Mock] Your thesis was unclear - state your main argument in the first 30 seconds.',
          '[Mock] The conclusion felt rushed - summarize your key points before ending.',
          '[Mock] Reduce filler words like "um" and "like" which appeared frequently.',
        ],
        practiceDrill: '[Mock] Configure DEEPSEEK_API_KEY for real feedback. Practice: Record a 2-minute speech where you pause for 1 full second between sentences.',
      },
      speechStats,
      isMock: true,
    });
  }

  try {
    // Generate feedback using DeepSeek
    const result = await generateDebateFeedback({
      transcript,
      bodyLanguageAnalysis,
      theme: theme || 'General Speech Practice',
      quote: quote || 'No specific quote provided',
      durationSeconds: durationSeconds || speechStats.wordCount > 0 ? Math.round((speechStats.wordCount / 130) * 60) : undefined,
      wordCount: speechStats.wordCount,
      wordsPerMinute: speechStats.wordsPerMinute,
      fillerCount: speechStats.fillerCount,
    });

    if (!result.success) {
      return res.status(500).json({
        error: result.error || 'Failed to generate feedback',
      });
    }

    console.log('✅ Feedback generation complete!');

    res.json({
      sessionId,
      feedback: result.feedback,
      speechStats,
      isMock: false,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Feedback generation failed:', errorMessage);
    res.status(500).json({
      error: `Feedback generation failed: ${errorMessage}`,
    });
  }
});

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, async () => {
  console.log('');
  console.log('🚀 Backend running at http://localhost:' + PORT);
  console.log('');
  
  // Check FFmpeg availability
  const ffmpegOk = await checkFfmpegAvailable();
  if (!ffmpegOk) {
    console.log('⚠️  WARNING: FFmpeg is not installed!');
    console.log('   Audio/video processing will not work without FFmpeg.');
    console.log('   Install it with: brew install ffmpeg (macOS)');
    console.log('');
  }
  
  // Check Qwen Audio API configuration
  if (!isQwenAudioConfigured()) {
    console.log('⚠️  WARNING: QWEN_AUDIO_API_KEY is not set!');
    console.log('   Transcription will return mock data.');
    console.log('');
  }

  // Check Qwen VL API configuration
  if (!isQwenVLConfigured()) {
    console.log('⚠️  WARNING: QWEN_VL_API_KEY is not set!');
    console.log('   Body language analysis will return mock data.');
    console.log('');
  }

  // Check DeepSeek API configuration
  if (!isDeepSeekConfigured()) {
    console.log('⚠️  WARNING: DEEPSEEK_API_KEY is not set!');
    console.log('   Debate feedback will return mock data.');
    console.log('');
  }
  
  console.log('Available endpoints:');
  console.log('  GET  /api/ping             - Health check');
  console.log('  GET  /api/status           - Check service configuration');
  console.log('  POST /api/start-round      - Get theme & quotes');
  console.log('  POST /api/upload           - Upload video recording');
  console.log('  POST /api/process-audio    - Transcribe recording');
  console.log('  POST /api/analyze-video    - Analyze body language');
  console.log('  POST /api/generate-feedback - Generate debate feedback');
  console.log('');
});
