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
import dns from 'node:dns';

// Fix for Node.js fetch "fetch failed" error on some network environments
// Prefers IPv4 over IPv6 when resolving hostnames
dns.setDefaultResultOrder('ipv4first');

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
      analysis: {
        overallScore: 6.5,
        performanceTier: "Local",
        tournamentReady: false,
        categoryScores: {
          content: { score: 6, weight: 0.40, weighted: 2.4 },
          delivery: { score: 7, weight: 0.30, weighted: 2.1 },
          language: { score: 7, weight: 0.15, weighted: 1.05 },
          bodyLanguage: { score: 6, weight: 0.15, weighted: 0.9 }
        },
        contentAnalysis: {
          topicAdherence: { 
            score: 7, 
            feedback: "**Score Justification:** You addressed the theme consistently throughout the speech, maintaining focus on the central thesis. Your interpretation was reasonable and defensible.\n\n**Evidence from Speech:**\n- Opening (0:15): Directly referenced the quote and established clear connection\n- Middle sections (1:30, 2:45): All points tied back to the theme\n- Avoided tangents and stayed on topic throughout\n\n**What This Means:** Your topic adherence is strong for local tournaments. You understand how to maintain thematic consistency.\n\n**How to Improve:**\n1. Deepen your interpretation: Instead of surface-level connection, explore nuanced meanings of the quote\n2. Explicitly link back: After each point, state \"This relates to [quote] because...\"\n3. Test each example: Ask \"Does this advance my thesis?\" before including it" 
          },
          argumentStructure: { 
            score: 6, 
            feedback: "**Score Justification:** You had a clear three-part structure (intro, body, conclusion), but transitions were weak and point development was uneven.\n\n**Evidence from Speech:**\n- Introduction (0:00-0:30): Clear thesis, but no roadmap previewing your points\n- Body: Two main points, but transition at 2:00 was abrupt (\"Also, another thing...\")\n- Conclusion: Summarized well but introduced new idea at 4:45\n\n**What This Means:** Your basic structure is sound, but competitive debaters need explicit signposting and balanced point development.\n\n**How to Improve:**\n1. Add roadmap: \"Today I'll explore three ways...\" in your intro (10 seconds)\n2. Use explicit transitions: \"My first point...\" \"Moving to my second point...\" \"Finally...\"\n3. Time your points: Aim for equal development (90 seconds each for two points)" 
          },
          depthOfAnalysis: { score: 5, feedback: "[Mock] Surface level analysis." },
          examplesEvidence: { score: 6, feedback: "[Mock] Good examples used." },
          timeManagement: { score: 7, feedback: "[Mock] Good use of time." }
        },
        deliveryAnalysis: {
          vocalVariety: { 
            score: 7, 
            feedback: "**Score Justification:** You demonstrated good vocal variety with clear tone changes and pitch modulation, though some sections remained in a single register.\n\n**Evidence from Speech:**\n- Opening (0:00-0:30): Dynamic introduction with rising pitch on key words\n- Point 1 (1:00-2:00): Maintained energy and varied tone appropriately\n- Point 2 (2:30-3:00): Became somewhat monotone during explanation at 2:45\n\n**What This Means:** Your vocal variety is competitive-ready for most sections, but needs consistency throughout to maintain audience engagement.\n\n**How to Improve:**\n1. Mark emphasis words during prep: Underline 3-5 words per point to emphasize with volume/pitch\n2. Use the \"Three Tones\" technique: Explanatory (mid-range), Narrative (warm, lower), Persuasive (high energy)\n3. Record and exaggerate: Practice with 50% more variety than feels natural—it will sound more engaging" 
          },
          pacing: { 
            score: 7, 
            wpm: 145, 
            feedback: "**Score Justification:** Your pace of 145 WPM falls within the optimal competitive range (140-160 WPM), and you used some strategic pauses.\n\n**Evidence from Speech:**\n- Overall WPM: 145 (725 words ÷ 5 minutes)  \n- Good pace during opening and conclusion\n- Rushed slightly during transition at 2:00 (approximately 170 WPM burst)\n- Used 2-second pause before thesis at 0:28 (excellent)\n\n**What This Means:** Your pacing is tournament-ready. The slight rush during transitions is common and easily fixable.\n\n**How to Improve:**\n1. Script transitions word-for-word during prep to avoid rushing between points\n2. Use \"count to three\" pauses after major statements (thesis, point summaries, before conclusion)\n3. Mark \"SLOW\" on prep paper at sections where you tend to rush" 
          },
          articulation: { score: 7, feedback: "[Mock] Clear enunciation." },
          fillerWords: { score: 8, total: 12, perMinute: 2.5, breakdown: { "um": 5, "uh": 7 }, feedback: "[Mock] Excellent filler control. Rate of 2.5 per minute is well below the 5/min competitive target." }
        },
        languageAnalysis: {
          vocabulary: { 
            score: 7, 
            feedback: "**Score Justification:** Your vocabulary was strong with good variety and academic register. Some repetition of key terms, but overall demonstrated linguistic sophistication.\n\n**Evidence from Speech:**\n- Used \"contentment\" and \"fulfillment\" instead of repeatedly saying \"happiness\" (good synonym variety)\n- Academic terms: \"intrinsic motivation\" (1:30), \"emotional intelligence\" (2:45)\n- Avoided casual phrases like \"stuff\" or \"things\" (professional register maintained)\n\n**What This Means:** Your vocabulary elevates your content to competitive level. You sound like a serious debater, not a casual speaker.\n\n**How to Improve:**\n1. Create synonym bank during prep: Write 5 synonyms for your key concept to rotate through speech\n2. Learn 2-3 academic terms per topic: For happiness topics, add \"hedonic adaptation,\" \"positive psychology,\" \"self-determination theory\"\n3. Use \"power verbs\": Replace \"makes us happy\" with \"cultivates joy,\" \"fosters well-being,\" \"generates contentment\"" 
          },
          rhetoricalDevices: { 
            score: 6, 
            examples: ["Rule of three at 3:20", "Rhetorical question at 0:15"], 
            feedback: "**Score Justification:** You used 2-3 rhetorical devices effectively, though integration could be more natural and variety could increase.\n\n**Evidence from Speech:**\n- Rhetorical question (0:15): \"What makes life meaningful?\" - effective hook\n- Rule of three (3:20): \"Through gratitude, through service, through challenge\" - memorable structure\n- Missed opportunities: Could have used metaphor, analogy, or parallel structure\n\n**What This Means:** You understand rhetorical devices but haven't fully integrated them as persuasive tools. Competitive speeches typically use 4-5 distinct devices.\n\n**How to Improve:**\n1. Add one metaphor per speech: \"Happiness isn't a destination—it's fuel for the journey\"\n2. Use parallel structure: \"We create happiness when we choose gratitude, when we pursue challenge, when we serve others\"\n3. End with anaphora: \"Tomorrow, build your happiness. Tomorrow, own your joy. Tomorrow, create your fulfillment.\"" 
          },
          emotionalAppeal: { score: 7, feedback: "[Mock] Strong pathos with good personal storytelling." },
          logicalAppeal: { score: 7, feedback: "[Mock] Clear cause-effect reasoning with strong logical connectors." }
        },
        bodyLanguageAnalysis: {
          eyeContact: { 
            score: 6, 
            percentage: 65, 
            feedback: "**Score Justification:** Your eye contact was 65% throughout the speech—below the competitive target of 75%+ but better than average. You broke eye contact during key moments which weakened impact.\n\n**Evidence from Speech:**\n- Opening (0:00-0:15): Strong 80% eye contact during hook\n- Thesis (0:28-0:35): Looked down at notes for 5 of 7 seconds—critical moment lost\n- Body points: Maintained 70% contact during first point, dropped to 50% during second point (2:30-3:15)\n- Conclusion: Good recovery with 75% contact, but final statement delivered while looking at notes\n\n**What This Means:** You need to memorize your most important moments (thesis, conclusion, key examples) to maintain connection with judges during these high-impact seconds.\n\n**How to Improve:**\n1. Minimal notes rule: Write only keywords on prep paper (\"P1: Gratitude | Ex: journal\"), not full sentences\n2. Memorize \"big three\": Thesis, best example, and closing sentence must be 100% from memory\n3. Five-second rule: Never look down for more than 5 consecutive seconds. Glance, absorb, look up, speak for 20+ seconds before next glance" 
          },
          gestures: { 
            score: 7, 
            feedback: "**Score Justification:** Your gestures were purposeful and natural, with good variety and appropriate timing. Minor issue: hands occasionally dropped to sides during explanatory sections.\n\n**Evidence from Speech:**\n- Opening: Open gestures, hands above waist, inviting (excellent)\n- Point 1 (1:30): Emphasized \"three ways\" with three fingers (perfect timing)\n- Point 2 (2:45): Hands dropped to sides for 15 seconds during explanation (lost energy)\n- Conclusion: Strong closing gesture on final words\n\n**What This Means:** Your gestures enhance your message when you use them. The key is maintaining gesture energy throughout, not just in high-energy moments.\n\n**How to Improve:**\n1. \"Hands above waist\" rule: Keep hands at chest/stomach level as default position, never hanging at sides\n2. Mark gesture moments during prep: Note 2-3 places per point where you'll use emphatic gestures\n3. Practice \"gesture hold\": After making a gesture (e.g., counting on fingers), hold it for 2-3 seconds before transitioning" 
          },
          posture: { score: 7, feedback: "[Mock] Confident, upright posture maintained throughout. Good professional presence." },
          stagePresence: { score: 7, feedback: "[Mock] Strong stage presence with good energy and confidence. Excellent audience connection." }
        },
        speechStats: {
          duration: "5:00",
          wordCount: 725,
          wpm: 145,
          fillerWordCount: 12,
          fillerWordRate: 2.4
        },
        structureAnalysis: {
          introduction: { timeRange: "0:00-0:30", assessment: "Strong opening with clear thesis statement. Hook effectively captures attention." },
          bodyPoints: [
            { timeRange: "0:30-1:45", assessment: "First main point well-articulated with supporting evidence. Clear reasoning." },
            { timeRange: "1:45-3:00", assessment: "Second point builds logically from the first. Good use of examples." },
            { timeRange: "3:00-4:30", assessment: "Final point effectively ties arguments together. Strong rhetorical appeal." }
          ],
          conclusion: { timeRange: "4:30-5:00", assessment: "Powerful conclusion with memorable closing statement." }
        },
        priorityImprovements: [
          { priority: 1, issue: "Eye contact", action: "Practice scanning the room", impact: "Increased audience engagement" }
        ],
        strengths: ["Strong delivery", "Good energy"],
        practiceDrill: "Practice with a mirror to improve eye contact.",
        nextSessionFocus: { primary: "Eye contact", metric: "75% consistent eye contact" }
      },
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
      // Return the exact failure reason (no secrets) so the frontend can show meaningful "technical details".
      return res.status(500).json({ error: result.error || 'Analysis failed' });
    }

    res.json({
      sessionId,
      transcript: result.transcript,
      analysis: result.analysis,
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
