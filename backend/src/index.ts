/**
 * Backend Server for Speech Practice App
 * 
 * This Express server handles:
 * - /api/ping - Health check endpoint
 * - /api/start-round - Returns theme and quotes for practice
 * - /api/upload - Accepts video recordings from users
 * - /api/process-all - Perform multimodal analysis (Audio/Video/Feedback) in one pass using Gemini
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Import our custom modules for Gemini multimodal analysis
import { analyzeSpeechWithGemini, isGeminiConfigured, getGeminiStatus } from './geminiClient';

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

function getAllowedOrigins(): string[] {
  // Prefer comma-separated list, fallback to single FRONTEND_URL
  const raw =
    process.env.FRONTEND_URLS ??
    process.env.FRONTEND_URL ??
    '';

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, server-to-server) where Origin header is absent
    if (!origin) return callback(null, true);

    // In local dev we allow any origin to reduce friction
    if (process.env.NODE_ENV !== 'production') return callback(null, true);

    const allowed = getAllowedOrigins();
    if (allowed.includes(origin)) return callback(null, true);

    /**
     * Cloudflare Pages preview deployments use subdomains like:
     *   https://<preview>.<project>.pages.dev
     *
     * If you only allow the production URL, previews will fail with CORS.
     * Default to allowing any subdomain of this project on pages.dev.
     */
    const pagesProject = process.env.CLOUDFLARE_PAGES_PROJECT || 'ballotv1';
    const pagesSuffix = `.${pagesProject}.pages.dev`;
    if (origin === `https://${pagesProject}.pages.dev` || origin.endsWith(pagesSuffix)) {
      return callback(null, true);
    }

    // Reject explicitly (results in missing CORS headers, which is what browsers enforce)
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// Enable CORS so frontend can call our API
app.use(cors(corsOptions));

// Handle preflight OPTIONS requests (must use the same options)
app.options('*', cors(corsOptions));

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
  const geminiStatus = getGeminiStatus();
  
  res.json({
    gemini: geminiStatus,
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
 * Multer / upload error handler
 * Ensures the frontend gets a clear JSON error instead of a generic HTML/stack trace.
 */
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Handle Multer errors (e.g. file too large)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Uploaded file is too large (limit is 100MB).' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  // Handle unknown errors
  if (err instanceof Error) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }

  return next();
});

/**
 * POST /api/process-all
 * Perform multimodal analysis (Audio/Video/Feedback) in one pass using Gemini
 * 
 * Expected JSON body: { sessionId: string }
 * Returns: { transcript, videoSummary, feedback, speechStats }
 */
app.post('/api/process-all', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  console.log('\n🌟 Processing multimodal analysis for session:', sessionId);

  const sessionData = sessionStorage.get(sessionId);
  if (!sessionData) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { filePath: videoPath, theme, quote } = sessionData;

  if (!fs.existsSync(videoPath)) {
    sessionStorage.delete(sessionId);
    return res.status(404).json({ error: 'Video file not found' });
  }

  if (!isGeminiConfigured()) {
    console.warn('⚠️ Gemini API not configured - returning mock data');
    return res.json({
      sessionId,
      transcript: "[Mock Transcript] Gemini API is not configured. Please add OPENROUTER_API_KEY to your .env file.",
      videoSummary: "[Mock Analysis] The speaker appears engaged in the video.",
      feedback: {
        contentSummary: "[Mock] A summary of the speech.",
        scores: { structure: 7, content: 6, delivery: 7 },
        strengths: ["[Mock] Good energy"],
        improvements: ["[Mock] More eye contact"],
        practiceDrill: "[Mock] Practice with a timer."
      },
      speechStats: { wordCount: 0, wordsPerMinute: 0, fillerCount: 0 },
      isMock: true,
    });
  }

  try {
    const result = await analyzeSpeechWithGemini({
      videoPath,
      theme: theme || 'General Practice',
      quote: quote || 'No specific quote',
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Gemini analysis failed' });
    }

    // Calculate speech stats from the transcript Gemini provided
    const speechStats = calculateSpeechStats(result.transcript);

    res.json({
      sessionId,
      transcript: result.transcript,
      videoSummary: result.bodyLanguageAnalysis,
      feedback: result.feedback,
      speechStats,
      isMock: false,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Multimodal analysis failed:', errorMessage);
    res.status(500).json({ error: `Analysis failed: ${errorMessage}` });
  }
});

// Remove old endpoints
// /api/process-audio, /api/analyze-video, /api/generate-feedback have been removed

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

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, async () => {
  console.log('');
  console.log('🚀 Backend running at http://localhost:' + PORT);
  console.log('');
  
  // Check Gemini API configuration
  if (!isGeminiConfigured()) {
    console.log('⚠️  WARNING: OPENROUTER_API_KEY is not set!');
    console.log('   Analysis will return mock data.');
    console.log('');
  }
  
  console.log('Available endpoints:');
  console.log('  GET  /api/ping             - Health check');
  console.log('  GET  /api/status           - Check service configuration');
  console.log('  POST /api/start-round      - Get theme & quotes');
  console.log('  POST /api/upload           - Upload video recording');
  console.log('  POST /api/process-all      - Multimodal analysis (Gemini)');
  console.log('');
});
