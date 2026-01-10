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
  durationSecondsHint?: number;
}

const sessionStorage: Map<string, SessionData> = new Map();

/**
 * Saved analysis results (persisted separately from job state)
 * This allows us to return analysis even if job data is stale
 */
interface SavedAnalysis {
  sessionId: string;
  transcript: string;
  analysis: any;
  isMock: boolean;
  savedAt: Date;
}

const analysisStorage: Map<string, SavedAnalysis> = new Map();

/**
 * Job status for async analysis processing
 * Enables the frontend to poll for results without timing out
 */
type JobStatus = 'queued' | 'processing' | 'complete' | 'error';

interface AnalysisJob {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  progress: number;       // 0-100 progress percentage
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;     // Set when job finishes (success or error)
  // Result fields (populated when complete)
  transcript?: string;
  analysis?: any;
  isMock?: boolean;
  // Error field (populated on failure)
  error?: string;
}

/**
 * In-memory job store for analysis jobs
 * Keyed by sessionId for easy lookup
 */
const jobStorage: Map<string, AnalysisJob> = new Map();

/**
 * Clean up old jobs and analyses periodically (keep for 1 hour)
 */
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  let cleanedJobs = 0;
  let cleanedAnalyses = 0;
  
  for (const [sessionId, job] of jobStorage.entries()) {
    if (now - job.createdAt.getTime() > JOB_TTL_MS) {
      jobStorage.delete(sessionId);
      cleanedJobs++;
    }
  }
  
  for (const [sessionId, analysis] of analysisStorage.entries()) {
    if (now - analysis.savedAt.getTime() > JOB_TTL_MS) {
      analysisStorage.delete(sessionId);
      cleanedAnalyses++;
    }
  }
  
  if (cleanedJobs > 0 || cleanedAnalyses > 0) {
    console.log(`🧹 Cleanup: removed ${cleanedJobs} jobs, ${cleanedAnalyses} analyses`);
  }
}, 5 * 60 * 1000); // Check every 5 minutes

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
 * Expanded database with 40+ themes for diverse impromptu practice
 */
const THEMES_DATABASE = [
  // === CLASSIC PHILOSOPHY THEMES ===
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
    theme: 'Morality',
    quotes: [
      '"The only thing necessary for the triumph of evil is for good men to do nothing." — Edmund Burke',
      '"Morality is not the doctrine of how we may make ourselves happy, but of how we may make ourselves worthy of happiness." — Immanuel Kant',
      '"Right is right, even if everyone is against it, and wrong is wrong, even if everyone is for it." — William Penn',
    ],
  },

  // === PERSONAL GROWTH THEMES ===
  {
    theme: 'Success',
    quotes: [
      '"It is not enough to succeed. Others must fail." — Gore Vidal',
      '"Success is not final, failure is not fatal: it is the courage to continue that counts." — Winston Churchill',
      '"The only place where success comes before work is in the dictionary." — Vidal Sassoon',
    ],
  },
  {
    theme: 'Failure',
    quotes: [
      '"I have not failed. I\'ve just found 10,000 ways that won\'t work." — Thomas Edison',
      '"Failure is simply the opportunity to begin again, this time more intelligently." — Henry Ford',
      '"Ever tried. Ever failed. No matter. Try again. Fail again. Fail better." — Samuel Beckett',
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
    theme: 'Change',
    quotes: [
      '"The only constant in life is change." — Heraclitus',
      '"Be the change you wish to see in the world." — Mahatma Gandhi',
      '"Progress is impossible without change, and those who cannot change their minds cannot change anything." — George Bernard Shaw',
    ],
  },
  {
    theme: 'Ambition',
    quotes: [
      '"Ambition is the path to success. Persistence is the vehicle you arrive in." — Bill Bradley',
      '"A man\'s worth is no greater than his ambitions." — Marcus Aurelius',
      '"Ambition is a dream with a V8 engine." — Elvis Presley',
    ],
  },
  {
    theme: 'Perseverance',
    quotes: [
      '"It does not matter how slowly you go as long as you do not stop." — Confucius',
      '"Perseverance is not a long race; it is many short races one after the other." — Walter Elliot',
      '"The difference between a successful person and others is not a lack of strength, not a lack of knowledge, but rather a lack of will." — Vince Lombardi',
    ],
  },

  // === KNOWLEDGE & WISDOM THEMES ===
  {
    theme: 'Knowledge',
    quotes: [
      '"The more I learn, the more I realize how much I don\'t know." — Albert Einstein',
      '"Knowledge is power, but enthusiasm pulls the switch." — Ivern Ball',
      '"Real knowledge is to know the extent of one\'s ignorance." — Confucius',
    ],
  },
  {
    theme: 'Wisdom',
    quotes: [
      '"The only true wisdom is in knowing you know nothing." — Socrates',
      '"Knowledge speaks, but wisdom listens." — Jimi Hendrix',
      '"Turn your wounds into wisdom." — Oprah Winfrey',
    ],
  },
  {
    theme: 'Education',
    quotes: [
      '"Education is the most powerful weapon which you can use to change the world." — Nelson Mandela',
      '"The purpose of education is to replace an empty mind with an open one." — Malcolm Forbes',
      '"Education is not the filling of a pail, but the lighting of a fire." — W.B. Yeats',
    ],
  },
  {
    theme: 'Experience',
    quotes: [
      '"Experience is not what happens to you; it\'s what you do with what happens to you." — Aldous Huxley',
      '"Good judgment comes from experience, and experience comes from bad judgment." — Rita Mae Brown',
      '"The only source of knowledge is experience." — Albert Einstein',
    ],
  },

  // === HUMAN NATURE THEMES ===
  {
    theme: 'Happiness',
    quotes: [
      '"Happiness is not something ready-made. It comes from your own actions." — Dalai Lama',
      '"The secret of happiness is not in doing what one likes, but in liking what one does." — James M. Barrie',
      '"Happiness depends upon ourselves." — Aristotle',
    ],
  },
  {
    theme: 'Fear',
    quotes: [
      '"The only thing we have to fear is fear itself." — Franklin D. Roosevelt',
      '"Fear is the mind-killer." — Frank Herbert',
      '"He who fears he will suffer, already suffers because he fears." — Michel de Montaigne',
    ],
  },
  {
    theme: 'Hope',
    quotes: [
      '"Hope is being able to see that there is light despite all of the darkness." — Desmond Tutu',
      '"We must accept finite disappointment, but never lose infinite hope." — Martin Luther King Jr.',
      '"Hope is a waking dream." — Aristotle',
    ],
  },
  {
    theme: 'Love',
    quotes: [
      '"The greatest thing you\'ll ever learn is just to love and be loved in return." — Nat King Cole',
      '"Love all, trust a few, do wrong to none." — William Shakespeare',
      '"Where there is love there is life." — Mahatma Gandhi',
    ],
  },
  {
    theme: 'Identity',
    quotes: [
      '"To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment." — Ralph Waldo Emerson',
      '"Know thyself." — Socrates',
      '"We are what we repeatedly do. Excellence, then, is not an act, but a habit." — Aristotle',
    ],
  },

  // === LEADERSHIP & SOCIETY THEMES ===
  {
    theme: 'Leadership',
    quotes: [
      '"A leader is one who knows the way, goes the way, and shows the way." — John C. Maxwell',
      '"The greatest leader is not necessarily one who does the greatest things, but one who gets people to do the greatest things." — Ronald Reagan',
      '"Before you are a leader, success is all about growing yourself. When you become a leader, success is all about growing others." — Jack Welch',
    ],
  },
  {
    theme: 'Responsibility',
    quotes: [
      '"The price of greatness is responsibility." — Winston Churchill',
      '"With great power comes great responsibility." — Voltaire',
      '"You cannot escape the responsibility of tomorrow by evading it today." — Abraham Lincoln',
    ],
  },
  {
    theme: 'Sacrifice',
    quotes: [
      '"The ultimate measure of a man is not where he stands in moments of comfort and convenience, but where he stands at times of challenge and controversy." — Martin Luther King Jr.',
      '"Without sacrifice, there is no meaning." — Unknown',
      '"Great achievement is usually born of great sacrifice, and is never the result of selfishness." — Napoleon Hill',
    ],
  },
  {
    theme: 'Integrity',
    quotes: [
      '"Integrity is doing the right thing, even when no one is watching." — C.S. Lewis',
      '"Real integrity is doing the right thing, knowing that nobody\'s going to know whether you did it or not." — Oprah Winfrey',
      '"The supreme quality for leadership is unquestionably integrity." — Dwight D. Eisenhower',
    ],
  },

  // === TIME & LEGACY THEMES ===
  {
    theme: 'Time',
    quotes: [
      '"Time you enjoy wasting is not wasted time." — Marthe Troly-Curtin',
      '"Lost time is never found again." — Benjamin Franklin',
      '"The two most powerful warriors are patience and time." — Leo Tolstoy',
    ],
  },
  {
    theme: 'Legacy',
    quotes: [
      '"Carve your name on hearts, not tombstones. A legacy is etched into the minds of others and the stories they share about you." — Shannon Alder',
      '"What we do for ourselves dies with us. What we do for others and the world remains and is immortal." — Albert Pike',
      '"The greatest legacy one can pass on to one\'s children and grandchildren is not money, but rather a legacy of character and faith." — Billy Graham',
    ],
  },
  {
    theme: 'Death',
    quotes: [
      '"To the well-organized mind, death is but the next great adventure." — J.K. Rowling',
      '"The fear of death follows from the fear of life. A man who lives fully is prepared to die at any time." — Mark Twain',
      '"Death is not the opposite of life, but a part of it." — Haruki Murakami',
    ],
  },

  // === CREATIVITY & DREAMS THEMES ===
  {
    theme: 'Creativity',
    quotes: [
      '"Creativity is intelligence having fun." — Albert Einstein',
      '"The chief enemy of creativity is good sense." — Pablo Picasso',
      '"Creativity takes courage." — Henri Matisse',
    ],
  },
  {
    theme: 'Dreams',
    quotes: [
      '"All our dreams can come true, if we have the courage to pursue them." — Walt Disney',
      '"The future belongs to those who believe in the beauty of their dreams." — Eleanor Roosevelt',
      '"A dream you dream alone is only a dream. A dream you dream together is reality." — John Lennon',
    ],
  },
  {
    theme: 'Imagination',
    quotes: [
      '"Logic will get you from A to B. Imagination will take you everywhere." — Albert Einstein',
      '"Imagination is the beginning of creation." — George Bernard Shaw',
      '"The man who has no imagination has no wings." — Muhammad Ali',
    ],
  },

  // === RISK & OPPORTUNITY THEMES ===
  {
    theme: 'Risk',
    quotes: [
      '"Only those who will risk going too far can possibly find out how far one can go." — T.S. Eliot',
      '"Take risks: if you win, you will be happy; if you lose, you will be wise." — Unknown',
      '"The biggest risk is not taking any risk." — Mark Zuckerberg',
    ],
  },
  {
    theme: 'Opportunity',
    quotes: [
      '"In the middle of difficulty lies opportunity." — Albert Einstein',
      '"Opportunities don\'t happen. You create them." — Chris Grosser',
      '"A pessimist sees the difficulty in every opportunity; an optimist sees the opportunity in every difficulty." — Winston Churchill',
    ],
  },

  // === NATURE & ENVIRONMENT THEMES ===
  {
    theme: 'Nature',
    quotes: [
      '"In every walk with nature, one receives far more than he seeks." — John Muir',
      '"Look deep into nature, and then you will understand everything better." — Albert Einstein',
      '"The Earth does not belong to us: we belong to the Earth." — Chief Seattle',
    ],
  },
  {
    theme: 'Technology',
    quotes: [
      '"Technology is a useful servant but a dangerous master." — Christian Lous Lange',
      '"The real danger is not that computers will begin to think like men, but that men will begin to think like computers." — Sydney J. Harris',
      '"It has become appallingly obvious that our technology has exceeded our humanity." — Albert Einstein',
    ],
  },

  // === PERSPECTIVE & TRUTH THEMES ===
  {
    theme: 'Perspective',
    quotes: [
      '"We don\'t see things as they are, we see them as we are." — Anaïs Nin',
      '"Everything we hear is an opinion, not a fact. Everything we see is a perspective, not the truth." — Marcus Aurelius',
      '"If you change the way you look at things, the things you look at change." — Wayne Dyer',
    ],
  },
  {
    theme: 'Simplicity',
    quotes: [
      '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
      '"Life is really simple, but we insist on making it complicated." — Confucius',
      '"The ability to simplify means to eliminate the unnecessary so that the necessary may speak." — Hans Hofmann',
    ],
  },
  {
    theme: 'Balance',
    quotes: [
      '"Happiness is not a matter of intensity but of balance, order, rhythm and harmony." — Thomas Merton',
      '"Life is like riding a bicycle. To keep your balance, you must keep moving." — Albert Einstein',
      '"Balance is not something you find, it\'s something you create." — Jana Kingsford',
    ],
  },

  // === ACTION & WORDS THEMES ===
  {
    theme: 'Action',
    quotes: [
      '"The way to get started is to quit talking and begin doing." — Walt Disney',
      '"Well done is better than well said." — Benjamin Franklin',
      '"Action is the foundational key to all success." — Pablo Picasso',
    ],
  },
  {
    theme: 'Words',
    quotes: [
      '"Words are, of course, the most powerful drug used by mankind." — Rudyard Kipling',
      '"The pen is mightier than the sword." — Edward Bulwer-Lytton',
      '"Handle them carefully, for words have more power than atom bombs." — Pearl Strachan Hurd',
    ],
  },
  {
    theme: 'Silence',
    quotes: [
      '"Silence is a source of great strength." — Lao Tzu',
      '"In the end, we will remember not the words of our enemies, but the silence of our friends." — Martin Luther King Jr.',
      '"The quieter you become, the more you can hear." — Ram Dass',
    ],
  },

  // === CONFLICT & PEACE THEMES ===
  {
    theme: 'Conflict',
    quotes: [
      '"The greatest victory is that which requires no battle." — Sun Tzu',
      '"Peace is not absence of conflict, it is the ability to handle conflict by peaceful means." — Ronald Reagan',
      '"Whenever you\'re in conflict with someone, there is one factor that can make the difference between damaging your relationship and deepening it. That factor is attitude." — William James',
    ],
  },
  {
    theme: 'Unity',
    quotes: [
      '"Alone we can do so little; together we can do so much." — Helen Keller',
      '"Unity is strength... when there is teamwork and collaboration, wonderful things can be achieved." — Mattie Stepanek',
      '"We may have all come on different ships, but we\'re in the same boat now." — Martin Luther King Jr.',
    ],
  },

  // === WEALTH & POVERTY THEMES ===
  {
    theme: 'Wealth',
    quotes: [
      '"Wealth consists not in having great possessions, but in having few wants." — Epictetus',
      '"It is not the man who has too little, but the man who craves more, that is poor." — Seneca',
      '"The real measure of your wealth is how much you\'d be worth if you lost all your money." — Unknown',
    ],
  },
  {
    theme: 'Gratitude',
    quotes: [
      '"Gratitude turns what we have into enough." — Anonymous',
      '"When I started counting my blessings, my whole life turned around." — Willie Nelson',
      '"Gratitude is not only the greatest of virtues, but the parent of all others." — Cicero',
    ],
  },

  // === YOUTH & AGE THEMES ===
  {
    theme: 'Youth',
    quotes: [
      '"Youth is wasted on the young." — George Bernard Shaw',
      '"The young do not know enough to be prudent, and therefore they attempt the impossible, and achieve it, generation after generation." — Pearl S. Buck',
      '"Youth is the gift of nature, but age is a work of art." — Stanislaw Jerzy Lec',
    ],
  },
  {
    theme: 'Memory',
    quotes: [
      '"The past beats inside me like a second heart." — John Banville',
      '"Memory is the diary we all carry about with us." — Oscar Wilde',
      '"We do not remember days, we remember moments." — Cesare Pavese',
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
 * Optional JSON fields in body: theme, quote, durationSeconds
 * Returns: { sessionId, jobId, filePath, message }
 * 
 * This endpoint now also queues the analysis job immediately,
 * so the frontend can navigate directly to /processing?sessionId=X&jobId=Y
 */
app.post('/api/upload', upload.single('file'), (req, res) => {
  // Check if file was provided
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Generate a unique session ID for this upload
  const sessionId = uuidv4();
  const jobId = uuidv4();
  
  // Get the path where the file was saved
  const filePath = req.file.path;

  // Store the session data for later retrieval (including theme/quote if provided)
  const durationSecondsHintRaw = req.body?.durationSeconds;
  const durationSecondsHintParsed =
    typeof durationSecondsHintRaw === 'string' || typeof durationSecondsHintRaw === 'number'
      ? Number(durationSecondsHintRaw)
      : undefined;
  const durationSecondsHint =
    typeof durationSecondsHintParsed === 'number' && Number.isFinite(durationSecondsHintParsed) && durationSecondsHintParsed > 0
      ? Math.round(durationSecondsHintParsed)
      : undefined;

  const sessionData: SessionData = {
    filePath,
    uploadedAt: new Date(),
    theme: req.body.theme,
    quote: req.body.quote,
    durationSecondsHint,
  };

  sessionStorage.set(sessionId, sessionData);

  // Create job immediately so it's ready for polling
  const now = new Date();
  const job: AnalysisJob = {
    jobId,
    sessionId,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  jobStorage.set(sessionId, job);

  console.log('📹 Video uploaded successfully!');
  console.log('   Session ID:', sessionId);
  console.log('   Job ID:', jobId);
  console.log('   File path:', filePath);
  console.log('   File size:', (req.file.size / 1024 / 1024).toFixed(2), 'MB');
  if (durationSecondsHint) console.log('   Client duration hint:', durationSecondsHint, 'sec');
  console.log('   Active sessions:', sessionStorage.size);

  // Start processing in background immediately
  processAnalysisJob(sessionId, sessionData).catch((err) => {
    console.error(`❌ Background job failed for session ${sessionId}:`, err);
  });

  // Return success response with both sessionId and jobId
  res.json({
    sessionId,
    jobId,
    filePath,
    message: 'Upload successful! Analysis queued.',
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
 * Queue multimodal analysis (Audio/Video/Feedback) and return immediately
 * 
 * This endpoint now returns immediately with a job status, enabling the frontend
 * to poll for results without timing out during high-concurrency classroom scenarios.
 * 
 * NOTE: The /api/upload endpoint now queues jobs automatically. This endpoint
 * is kept for backward compatibility and handles edge cases (e.g., job needs restart).
 * 
 * Expected JSON body: { sessionId: string }
 * Returns: { jobId, sessionId, status: 'queued' | 'processing' | 'complete', progress }
 */
app.post('/api/process-all', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  console.log('\n🌟 [process-all] Request for session:', sessionId);

  // Check if analysis already exists (fast path)
  const savedAnalysis = analysisStorage.get(sessionId);
  if (savedAnalysis) {
    console.log(`✅ [process-all] Analysis already exists for ${sessionId}, returning complete`);
    const job = jobStorage.get(sessionId);
    return res.json({
      jobId: job?.jobId || 'completed',
      sessionId,
      status: 'complete',
      progress: 100,
    });
  }

  const sessionData = sessionStorage.get(sessionId);
  if (!sessionData) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { filePath: videoPath } = sessionData;

  if (!fs.existsSync(videoPath)) {
    sessionStorage.delete(sessionId);
    return res.status(404).json({ error: 'Video file not found' });
  }

  // Check if there's already a job for this session
  const existingJob = jobStorage.get(sessionId);
  if (existingJob) {
    console.log(`📋 [process-all] Existing job for ${sessionId}: status=${existingJob.status}, progress=${existingJob.progress}`);
    return res.json({
      jobId: existingJob.jobId,
      sessionId,
      status: existingJob.status,
      progress: existingJob.progress || 0,
    });
  }

  // Create a new job (shouldn't happen often since /api/upload creates it)
  const jobId = uuidv4();
  const now = new Date();
  const job: AnalysisJob = {
    jobId,
    sessionId,
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  jobStorage.set(sessionId, job);

  console.log(`📝 [process-all] Created job ${jobId} for session ${sessionId}`);

  // Return immediately - frontend will poll for status
  res.json({
    jobId,
    sessionId,
    status: 'queued',
    progress: 0,
  });

  // Process in background (fire-and-forget)
  processAnalysisJob(sessionId, sessionData).catch((err) => {
    console.error(`❌ Background job failed for session ${sessionId}:`, err);
  });
});

/**
 * Helper function to save analysis results to persistent storage
 * Called on ALL successful analysis paths to ensure data is preserved
 */
function saveAnalysis(sessionId: string, transcript: string, analysis: any, isMock: boolean): void {
  const savedAnalysis: SavedAnalysis = {
    sessionId,
    transcript,
    analysis,
    isMock,
    savedAt: new Date(),
  };
  analysisStorage.set(sessionId, savedAnalysis);
  console.log(`💾 [saveAnalysis] Analysis saved for session ${sessionId}`);
}

/**
 * Helper function to mark job as completed
 * MUST be called on every completion path (success or error)
 */
function completeJob(
  job: AnalysisJob,
  status: 'complete' | 'error',
  data: { transcript?: string; analysis?: any; isMock?: boolean; error?: string }
): void {
  const now = new Date();
  job.status = status;
  job.progress = status === 'complete' ? 100 : job.progress;
  job.completedAt = now;
  job.updatedAt = now;
  
  if (data.transcript !== undefined) job.transcript = data.transcript;
  if (data.analysis !== undefined) job.analysis = data.analysis;
  if (data.isMock !== undefined) job.isMock = data.isMock;
  if (data.error !== undefined) job.error = data.error;
  
  console.log(`📊 [completeJob] Job ${job.jobId} for session ${job.sessionId} -> status=${status}, progress=${job.progress}`);
}

/**
 * Background processing function for analysis jobs
 * Uses try/catch/finally pattern to ensure job completion is ALWAYS recorded
 */
async function processAnalysisJob(sessionId: string, sessionData: SessionData): Promise<void> {
  const job = jobStorage.get(sessionId);
  if (!job) {
    console.error(`❌ [processAnalysisJob] Job not found for session ${sessionId}`);
    return;
  }

  // Check if analysis already exists (avoid duplicate processing)
  const existingAnalysis = analysisStorage.get(sessionId);
  if (existingAnalysis) {
    console.log(`✅ [processAnalysisJob] Analysis already exists for ${sessionId}, marking job complete`);
    completeJob(job, 'complete', {
      transcript: existingAnalysis.transcript,
      analysis: existingAnalysis.analysis,
      isMock: existingAnalysis.isMock,
    });
    return;
  }

  // Update status to processing
  job.status = 'processing';
  job.progress = 10;
  job.updatedAt = new Date();
  console.log(`🔄 [processAnalysisJob] Processing analysis for session ${sessionId}...`);

  // Optional: Simulate processing delay for testing classroom concurrency
  const simulatedDelayMs = parseInt(process.env.SIMULATE_PROCESSING_DELAY_MS || '0', 10);
  if (simulatedDelayMs > 0) {
    console.log(`🧪 Simulating ${simulatedDelayMs}ms processing delay...`);
    await new Promise(resolve => setTimeout(resolve, simulatedDelayMs));
    console.log(`🧪 Simulated delay complete`);
  }

  const { filePath: videoPath, theme, quote } = sessionData;

  // Handle mock mode (Gemini not configured)
  if (!isGeminiConfigured()) {
    console.warn('⚠️ [processAnalysisJob] Gemini API not configured - storing mock data');
    const mockTranscript = "[Mock Transcript] Gemini API is not configured. Please add OPENROUTER_API_KEY to your .env file.";
    const mockAnalysis = getMockAnalysis();
    
    // Save to both storages
    saveAnalysis(sessionId, mockTranscript, mockAnalysis, true);
    completeJob(job, 'complete', {
      transcript: mockTranscript,
      analysis: mockAnalysis,
      isMock: true,
    });
    return;
  }

  // Main analysis - wrapped in try/finally to guarantee job completion
  let analysisSucceeded = false;
  let analysisError: string | undefined;
  
  try {
    const safeTheme = typeof theme === 'string' && theme.trim() ? theme.trim() : '';
    const safeQuote = typeof quote === 'string' && quote.trim() ? quote.trim() : '';
    if (!safeTheme) {
      console.warn(`⚠️ [processAnalysisJob] Missing theme for session ${sessionId}. Using "Unknown".`);
    }
    if (!safeQuote) {
      console.warn(`⚠️ [processAnalysisJob] Missing quote for session ${sessionId}. Using "Unknown quote".`);
    }

    job.progress = 30;
    job.updatedAt = new Date();

    const result = await analyzeSpeechWithGemini({
      videoPath,
      theme: safeTheme || 'Unknown',
      quote: safeQuote || 'Unknown quote',
      durationSecondsHint: sessionData.durationSecondsHint,
    });

    job.progress = 90;
    job.updatedAt = new Date();

    if (!result.success) {
      analysisError = result.error || 'Analysis failed';
      console.error(`❌ [processAnalysisJob] Analysis returned error for session ${sessionId}: ${analysisError}`);
    } else {
      // SUCCESS PATH - save analysis AND complete job
      analysisSucceeded = true;
      const transcript = result.transcript || '';
      const analysis = result.analysis;
      
      console.log(`✅ [processAnalysisJob] Analysis succeeded for session ${sessionId}`);
      
      // CRITICAL: Save analysis first, then update job
      saveAnalysis(sessionId, transcript, analysis, false);
      completeJob(job, 'complete', {
        transcript,
        analysis,
        isMock: false,
      });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    analysisError = `Analysis exception: ${errorMessage}`;
    console.error(`❌ [processAnalysisJob] Exception for session ${sessionId}:`, errorMessage);
  } finally {
    // GUARANTEE: Job is marked complete/error even if early return was missed
    if (!analysisSucceeded && job.status !== 'complete' && job.status !== 'error') {
      console.warn(`⚠️ [processAnalysisJob] Finally block catching incomplete job for ${sessionId}`);
      completeJob(job, 'error', { error: analysisError || 'Analysis did not complete properly' });
    }
  }
}

/**
 * GET /api/analysis-status
 * Poll for analysis job status and results
 * 
 * IMPORTANT: If analysis exists in storage, return 'complete' regardless of job state.
 * This handles race conditions where job state is stale but analysis succeeded.
 * 
 * Query params: sessionId, jobId (optional, for logging)
 * Returns: { jobId, sessionId, status, progress, transcript?, analysis?, isMock?, error? }
 */
app.get('/api/analysis-status', (req, res) => {
  const sessionId = req.query.sessionId as string;
  const jobId = req.query.jobId as string;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId query parameter' });
  }

  console.log(`📊 [analysis-status] Poll for session=${sessionId}, jobId=${jobId || 'not provided'}`);

  // PRIORITY 1: Check if analysis already exists (completed successfully)
  const savedAnalysis = analysisStorage.get(sessionId);
  if (savedAnalysis) {
    const job = jobStorage.get(sessionId);
    console.log(`✅ [analysis-status] Analysis found for ${sessionId}, returning complete`);
    return res.json({
      jobId: job?.jobId || 'completed',
      sessionId,
      status: 'complete',
      progress: 100,
      createdAt: job?.createdAt?.toISOString() || savedAnalysis.savedAt.toISOString(),
      updatedAt: savedAnalysis.savedAt.toISOString(),
      transcript: savedAnalysis.transcript,
      analysis: savedAnalysis.analysis,
      isMock: savedAnalysis.isMock,
    });
  }

  // PRIORITY 2: Check job state
  const job = jobStorage.get(sessionId);
  if (!job) {
    console.warn(`⚠️ [analysis-status] No job found for session ${sessionId}`);
    return res.status(404).json({ error: 'No analysis job found for this session' });
  }

  console.log(`📊 [analysis-status] Job status for ${sessionId}: status=${job.status}, progress=${job.progress}`);

  // Build response based on job status
  const response: any = {
    jobId: job.jobId,
    sessionId: job.sessionId,
    status: job.status,
    progress: job.progress || 0,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };

  if (job.completedAt) {
    response.completedAt = job.completedAt.toISOString();
  }

  if (job.status === 'complete') {
    response.transcript = job.transcript;
    response.analysis = job.analysis;
    response.isMock = job.isMock;
  } else if (job.status === 'error') {
    response.error = job.error;
  }

  res.json(response);
});

/**
 * Returns mock analysis data for when Gemini is not configured
 */
function getMockAnalysis() {
  return {
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
  };
}

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
  
  // Check for simulated delay (testing)
  const simulatedDelay = process.env.SIMULATE_PROCESSING_DELAY_MS;
  if (simulatedDelay) {
    console.log(`🧪 TESTING MODE: Simulated processing delay of ${simulatedDelay}ms enabled`);
    console.log('');
  }
  
  console.log('Available endpoints:');
  console.log('  GET  /api/ping             - Health check');
  console.log('  GET  /api/status           - Check service configuration');
  console.log('  POST /api/start-round      - Get theme & quotes');
  console.log('  POST /api/upload           - Upload video recording');
  console.log('  POST /api/process-all      - Queue multimodal analysis');
  console.log('  GET  /api/analysis-status  - Poll analysis job status');
  console.log('');
});
