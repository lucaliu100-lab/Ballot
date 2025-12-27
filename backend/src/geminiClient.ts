/**
 * Gemini Client Module (via OpenRouter)
 * 
 * Handles multimodal analysis (Video + Audio) using Gemini 2.0 Flash.
 * Uses the OpenRouter API for unified model access.
 */

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

// ===========================================
// CONFIGURATION
// ===========================================

function getApiKey(): string {
  // Use the OpenRouter API key from .env
  return process.env.OPENROUTER_API_KEY || '';
}

function getModel(): string {
  // Production-stable ID for Gemini 2.0 Flash on OpenRouter
  return process.env.GEMINI_MODEL || 'google/gemini-2.0-flash-001';
}

// ===========================================
// TYPES
// ===========================================

export interface GeminiAnalysisInput {
  videoPath: string;
  theme: string;
  quote: string;
}

export interface GeminiAnalysisResult {
  success: boolean;
  transcript: string;
  analysis?: {
    overallScore: number;
    performanceTier: string;
    tournamentReady: boolean;
    categoryScores: {
      content: { score: number; weight: number; weighted: number };
      delivery: { score: number; weight: number; weighted: number };
      language: { score: number; weight: number; weighted: number };
      bodyLanguage: { score: number; weight: number; weighted: number };
    };
    contentAnalysis: {
      topicAdherence: { score: number; feedback: string };
      argumentStructure: { score: number; feedback: string };
      depthOfAnalysis: { score: number; feedback: string };
      examplesEvidence: { score: number; feedback: string };
      timeManagement: { score: number; feedback: string };
    };
    deliveryAnalysis: {
      vocalVariety: { score: number; feedback: string };
      pacing: { score: number; wpm: number; feedback: string };
      articulation: { score: number; feedback: string };
      fillerWords: {
        score: number;
        total: number;
        perMinute: number;
        breakdown: Record<string, number>;
        feedback: string;
      };
    };
    languageAnalysis: {
      vocabulary: { score: number; feedback: string };
      rhetoricalDevices: { score: number; examples: string[]; feedback: string };
      emotionalAppeal: { score: number; feedback: string };
      logicalAppeal: { score: number; feedback: string };
    };
    bodyLanguageAnalysis: {
      eyeContact: { score: number; percentage: number; feedback: string };
      gestures: { score: number; feedback: string };
      posture: { score: number; feedback: string };
      stagePresence: { score: number; feedback: string };
    };
    speechStats: {
      duration: string;
      wordCount: number;
      wpm: number;
      fillerWordCount: number;
      fillerWordRate: number;
    };
    structureAnalysis: {
      introduction: { timeRange: string; assessment: string };
      bodyPoints: Array<{ timeRange: string; assessment: string }>;
      conclusion: { timeRange: string; assessment: string };
    };
    priorityImprovements: Array<{
      priority: number;
      issue: string;
      action: string;
      impact: string;
    }>;
    strengths: string[];
    practiceDrill: string;
    nextSessionFocus: { primary: string; metric: string };
  };
  error?: string;
}

// ===========================================
// HELPERS
// ===========================================

// Configure ffmpeg/ffprobe paths (bundled installers) for reliable local transcoding.
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

function mb(bytes: number): number {
  return bytes / (1024 * 1024);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function statSizeMB(filePath: string): Promise<number> {
  const stats = await fs.promises.stat(filePath);
  return mb(stats.size);
}

async function getVideoDurationSeconds(filePath: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration;
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        return resolve(duration);
      }
      return reject(new Error('Unable to determine video duration.'));
    });
  });
}

function formatDurationSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function countFillers(text: string): { total: number; breakdown: Record<string, number> } {
  const fillers = [
    'um',
    'uh',
    'like',
    'you know',
    'so',
    'basically',
    'actually',
    'literally',
    'kind of',
    'sort of',
  ];

  const lower = text.toLowerCase();
  const breakdown: Record<string, number> = {};
  let total = 0;

  for (const f of fillers) {
    const pattern = f.includes(' ')
      ? new RegExp(`\\b${f.replace(/\s+/g, '\\s+')}\\b`, 'g')
      : new RegExp(`\\b${f}\\b`, 'g');
    const matches = lower.match(pattern);
    const count = matches ? matches.length : 0;
    if (count > 0) breakdown[f] = count;
    total += count;
  }

  return { total, breakdown };
}

function buildInsufficientSpeechAnalysis(durationSeconds: number, reason: string): NonNullable<GeminiAnalysisResult['analysis']> {
  const duration = formatDurationSeconds(durationSeconds);
  const warning = `⚠️ INSUFFICIENT SPEECH DATA: ${reason}`;
  const feedback = `**Score Justification:** ${warning}\n\n**Evidence from Speech:**\n- Transcript is empty or too short to evaluate.\n\n**What This Means:** We cannot fairly score competitive impromptu categories without audible speech and a usable transcript.\n\n**How to Improve:**\n1. Re-record ensuring microphone permissions are enabled and audio is captured clearly.\n2. Speak continuously for competitive length (4–6 minutes optimal) instead of extended silence.\n3. Test a 10-second recording and confirm playback has clear audio before starting a full round.`;

  return {
    overallScore: 1.0,
    performanceTier: 'Developing',
    tournamentReady: false,
    categoryScores: {
      content: { score: 1.0, weight: 0.4, weighted: 0.4 },
      delivery: { score: 1.0, weight: 0.3, weighted: 0.3 },
      language: { score: 1.0, weight: 0.15, weighted: 0.15 },
      bodyLanguage: { score: 1.0, weight: 0.15, weighted: 0.15 },
    },
    contentAnalysis: {
      topicAdherence: { score: 1.0, feedback },
      argumentStructure: { score: 1.0, feedback },
      depthOfAnalysis: { score: 1.0, feedback },
      examplesEvidence: { score: 1.0, feedback },
      timeManagement: { score: 1.0, feedback },
    },
    deliveryAnalysis: {
      vocalVariety: { score: 1.0, feedback },
      pacing: { score: 1.0, wpm: 0, feedback },
      articulation: { score: 1.0, feedback },
      fillerWords: { score: 10.0, total: 0, perMinute: 0, breakdown: {}, feedback },
    },
    languageAnalysis: {
      vocabulary: { score: 1.0, feedback },
      rhetoricalDevices: { score: 1.0, examples: [], feedback },
      emotionalAppeal: { score: 1.0, feedback },
      logicalAppeal: { score: 1.0, feedback },
    },
    bodyLanguageAnalysis: {
      eyeContact: { score: 1.0, percentage: 0, feedback },
      gestures: { score: 1.0, feedback },
      posture: { score: 1.0, feedback },
      stagePresence: { score: 1.0, feedback },
    },
    speechStats: {
      duration,
      wordCount: 0,
      wpm: 0,
      fillerWordCount: 0,
      fillerWordRate: 0,
    },
    structureAnalysis: {
      introduction: { timeRange: 'N/A', assessment: 'No usable speech detected.' },
      bodyPoints: [],
      conclusion: { timeRange: 'N/A', assessment: 'No usable speech detected.' },
    },
    priorityImprovements: [
      { priority: 1, issue: 'No usable speech detected', action: 'Verify microphone + speak continuously', impact: 'Required for any meaningful judging.' },
      { priority: 2, issue: 'Audio capture reliability', action: 'Test a 10-second recording before full round', impact: 'Prevents wasted long recordings.' },
      { priority: 3, issue: 'Competitive length', action: 'Target 4–6 minutes of continuous speaking', impact: 'Needed for NSDA-standard development.' },
    ],
    strengths: [],
    practiceDrill: 'Record 20 seconds, replay to confirm audio, then re-record the full round with continuous speech.',
    nextSessionFocus: { primary: 'Capture clean audio + continuous speech', metric: '≥ 400 words and non-empty transcript' },
  };
}

function ensureMinPriorityImprovements(analysis: any, minCount: number): void {
  if (!analysis || typeof analysis !== 'object') return;
  const existing = Array.isArray(analysis.priorityImprovements)
    ? analysis.priorityImprovements.filter((x: any) => x && typeof x === 'object')
    : [];

  if (existing.length >= minCount) {
    analysis.priorityImprovements = existing;
    return;
  }

  const nextPriority =
    (existing.length ? Math.max(...existing.map((x: any) => Number(x.priority) || 0)) : 0) + 1;

  // “Next 20%” improvements: not necessarily the biggest problems, but high ROI refinements.
  const candidates = [
    {
      issue: 'Sharper signposting between points',
      action: 'Add explicit transitions: “First… Second… Finally…” and a 1-sentence roadmap in the intro.',
      impact: 'Improves judge flow and clarity immediately with minimal effort.',
    },
    {
      issue: 'Stronger conclusion (thesis return + closer)',
      action: 'Use a 20–30s conclusion formula: recap points → restate thesis → 1 memorable final line.',
      impact: 'Turns “good content” into a persuasive finish that sticks on ballots.',
    },
    {
      issue: 'Cleaner pacing at transitions',
      action: 'Insert a 1–2s pause before each new point; script transition sentences during prep.',
      impact: 'Reduces rushed sections and increases comprehension and confidence.',
    },
    {
      issue: 'More specific examples',
      action: 'Add 1 concrete example per point (name/place/event) + 1 sentence explaining why it proves the claim.',
      impact: 'Boosts credibility and depth without adding much time.',
    },
  ];

  const toAdd: any[] = [];
  let p = nextPriority;
  for (const c of candidates) {
    if (existing.length + toAdd.length >= minCount) break;
    toAdd.push({ priority: p++, ...c });
  }

  analysis.priorityImprovements = [...existing, ...toAdd].slice(0, minCount);
}

async function transcodeVideoForAnalysis(inputPath: string): Promise<string> {
  // Target: keep payload small enough for OpenRouter reliability by downscaling and reducing bitrate.
  const outDir = path.resolve(__dirname, '../temp/transcoded');
  await ensureDir(outDir);

  const base = path.basename(inputPath, path.extname(inputPath));
  const outPath = path.join(outDir, `${base}-compressed.mp4`);

  // Reuse if already exists and newer than input
  try {
    const [inStat, outStat] = await Promise.all([
      fs.promises.stat(inputPath),
      fs.promises.stat(outPath),
    ]);
    if (outStat.mtimeMs >= inStat.mtimeMs) {
      return outPath;
    }
  } catch {
    // ignore missing output
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      // Downscale to 360p height, keep aspect ratio, and reduce FPS to lower size.
      .outputOptions([
        '-vf', 'scale=-2:360,fps=12',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        // Use a high CRF to keep file small; tuned for analysis (not quality viewing).
        '-crf', '32',
        '-pix_fmt', 'yuv420p',
        // Audio kept but heavily compressed; mono.
        '-c:a', 'aac',
        '-b:a', '32k',
        '-ac', '1',
        '-movflags', '+faststart',
      ])
      .on('start', (cmd) => {
        console.log('   🎛️  Transcoding for analysis:', cmd);
      })
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outPath);
  });

  return outPath;
}

/**
 * Encodes a local file to Base64 data URL
 */
async function encodeVideoToBase64(videoPath: string): Promise<string> {
  const stats = await fs.promises.stat(videoPath);
  const sizeInMB = stats.size / (1024 * 1024);
  
  // OpenRouter/Gemini usually handles up to 20MB-50MB via Base64. 
  // Warn if it's exceptionally large.
  if (sizeInMB > 15) {
    console.warn(`⚠️ Large video file detected (${sizeInMB.toFixed(2)}MB). Base64 encoding will increase this by ~33%.`);
  }

  const videoBuffer = await fs.promises.readFile(videoPath);
  const base64Video = videoBuffer.toString('base64');
  
  // Determine mime type based on extension
  const ext = path.extname(videoPath).toLowerCase();
  let mimeType = 'video/webm';
  if (ext === '.mp4') mimeType = 'video/mp4';
  if (ext === '.mov') mimeType = 'video/quicktime';

  return `data:${mimeType};base64,${base64Video}`;
}

// ===========================================
// MAIN ANALYSIS FUNCTION
// ===========================================

export async function analyzeSpeechWithGemini(
  input: GeminiAnalysisInput
): Promise<GeminiAnalysisResult> {
  const apiKey = getApiKey();
  const modelName = getModel();

  if (!apiKey) {
    return {
      success: false,
      transcript: '',
      error: 'OPENROUTER_API_KEY not found in environment variables.',
    };
  }

  console.log(`\n🌟 Analyzing via OpenRouter [Model: ${modelName}]...`);
  console.log(`   API Key present: ${apiKey ? 'Yes (starts with ' + apiKey.substring(0, 7) + '...)' : 'No'}`);
  console.log(`   Video path: ${input.videoPath}`);

  try {
    const durationSeconds = await getVideoDurationSeconds(input.videoPath);
    console.log(`   🎞️  Video duration (ffprobe): ${formatDurationSeconds(durationSeconds)}`);

    // Reliability: large videos often exceed gateway limits when Base64-encoded.
    // If file is large, transcode to a smaller MP4 before encoding.
    const originalSizeMb = await statSizeMB(input.videoPath);
    let videoPathForAnalysis = input.videoPath;
    if (originalSizeMb > 12) {
      console.warn(`⚠️ Large video (${originalSizeMb.toFixed(2)}MB) detected. Creating compressed analysis copy...`);
      videoPathForAnalysis = await transcodeVideoForAnalysis(input.videoPath);
      const compressedSizeMb = await statSizeMB(videoPathForAnalysis);
      console.log(`   ✅ Compressed video ready: ${compressedSizeMb.toFixed(2)}MB (${path.basename(videoPathForAnalysis)})`);
    }

    const base64Video = await encodeVideoToBase64(videoPathForAnalysis);
    console.log(`   Video encoded (Base64 length: ${base64Video.length})`);

    const prompt = `
      You are a professional NSDA impromptu judge for BALLOT, an elite debate training platform. Analyze this competitive impromptu speech with surgical precision.
      
      THEME: ${input.theme}
      QUOTE: ${input.quote}
      VIDEO_DURATION_SECONDS (measured): ${Math.round(durationSeconds)}
      VIDEO_DURATION (mm:ss, measured): ${formatDurationSeconds(durationSeconds)}
      
      ═══════════════════════════════════════════════════════════════════════════════
      CRITICAL JUDGING REQUIREMENTS
      ═══════════════════════════════════════════════════════════════════════════════

      1. SPEECH LENGTH VALIDATION (Competition Format: 7-minute total time budget)

      Under 3:00 minutes:
      - Apply -2.0 point penalty to Content score
      - Flag: "⚠️ INSUFFICIENT LENGTH FOR COMPETITIVE IMPROMPTU"
      - Explain: "At [X:XX], this speech is too short to demonstrate depth, multiple points, and proper structure. Minimum competitive length is 3 minutes; optimal is 4-6 minutes."

      3:00-3:59 minutes:
      - Apply -1.0 point penalty to Content score
      - Note: "Speech length below optimal range (4-6 minutes). Additional time needed for deeper argument development."

      4:00-6:00 minutes:
      - No penalty (OPTIMAL RANGE)
      - Note: "Speech length within optimal competitive range."

      6:01-7:00 minutes:
      - No penalty, but note: "Good length, though minimal prep time likely used. Most competitive speakers use 1-2 minutes of prep."

      Over 7:00 minutes:
      - Apply -0.5 point penalty to Time Management sub-score
      - Flag: "⚠️ EXCEEDS TIME LIMIT"
      - Note: "Speech exceeds 7-minute tournament time budget. Would result in disqualification. Practice time constraints."

      ═══════════════════════════════════════════════════════════════════════════════

      2. DETAILED FEEDBACK TEMPLATE (USE FOR EVERY SUB-CATEGORY)

      For EACH sub-score, structure feedback as follows:

      **Score Justification:**
      [2-3 sentences explaining WHY this specific score was assigned, referencing observable elements]

      **Evidence from Speech:**
      - [Specific example 1 with timestamp or direct quote from transcript]
      - [Specific example 2 with timestamp or direct quote from transcript]  
      - [Specific example 3 with timestamp or direct quote, if applicable]

      **What This Means:**
      [1-2 sentences interpreting what these examples reveal about performance. Connect to competitive standards.]

      **How to Improve:**
      1. [Concrete, actionable recommendation with specific example they can apply immediately]
      2. [Second specific recommendation with example]
      3. [Third specific recommendation with example, if applicable]

      This template ensures feedback is NEVER vague or generic. Every score must be defended with evidence and actionable steps.

      ═══════════════════════════════════════════════════════════════════════════════

      CRITICAL ANTI-HALLUCINATION RULES (MUST FOLLOW):
      - Do NOT invent transcript content, evidence, timestamps, or structure.
      - If audio is missing, mostly silence, or transcript is empty/very short, you MUST say so explicitly.
      - In that case, return a minimal evaluation: set low scores, set tournamentReady=false, and set structureAnalysis bodyPoints to [].
      - If transcript is empty, set speechStats.wordCount=0 and explain \"No usable speech detected\" in feedback fields.

      3. WEIGHTED SCORING SYSTEM

      - Content (40% weight): Structure, arguments, examples, depth, topic adherence, time management
      - Delivery (30% weight): Vocal variety, pacing (140-160 WPM ideal), articulation, filler control
      - Language (15% weight): Vocabulary sophistication, rhetorical devices, emotional/logical appeal
      - Body Language (15% weight): Eye contact (>75% target), gestures, posture, stage presence

      Overall Score = (Content × 0.40) + (Delivery × 0.30) + (Language × 0.15) + (Body Language × 0.15)

      ═══════════════════════════════════════════════════════════════════════════════

      4. CONTENT ANALYSIS (40% - Most Important)

      A. TOPIC ADHERENCE (0-10)
      Scoring Guide:
      - 9-10: Directly addressed topic; insightful interpretation; all points clearly relate to theme
      - 7-8: Addressed topic well; minor tangents; mostly relevant throughout
      - 5-6: Addressed topic but significant tangents; some points loosely connected
      - 3-4: Partially addressed topic; multiple tangents; unclear connection in sections
      - 1-2: Barely addressed topic; mostly off-topic; significant deviation from theme

      Evaluate: Did speaker directly address quote/theme? Stay on topic? Avoid tangents? Reasonable interpretation? Maintain focus on central thesis?

      B. ARGUMENT STRUCTURE (0-10)
      Scoring Guide:
      - 9-10: Flawless structure; clear thesis; 3 well-developed points; smooth transitions; strong conclusion
      - 7-8: Strong structure; clear points; good transitions; minor organizational issues
      - 5-6: Basic structure present; points somewhat clear; transitions weak; organizational issues
      - 3-4: Weak structure; unclear points; poor transitions; difficult to follow
      - 1-2: No clear structure; points indistinguishable; no organization

      Evaluate: Clear intro with thesis+roadmap? 2-3 distinct main points? Logical progression? Effective conclusion? Proper transitions?

      C. DEPTH OF ANALYSIS (0-10)
      Scoring Guide:
      - 9-10: Sophisticated, nuanced analysis; original insights; explores complexity; intellectually impressive
      - 7-8: Good depth; some nuance; mostly avoids clichés; solid critical thinking
      - 5-6: Surface-level analysis; some depth in places; some cliché arguments
      - 3-4: Mostly surface-level; obvious points; heavily reliant on clichés
      - 1-2: Entirely surface-level; no depth; only cliché arguments

      Evaluate: Surface vs sophisticated thinking? Nuance and complexity? Original insights (not clichés)? Critical thinking? Intellectual depth appropriate for competitive level?

      D. EXAMPLES & EVIDENCE (0-10)
      Scoring Guide:
      - 9-10: 3+ strong, specific examples; excellent variety; perfectly integrated; highly relevant
      - 7-8: 2-3 solid examples; good specificity; well integrated; relevant
      - 5-6: 1-2 examples; somewhat vague; adequate integration; somewhat relevant
      - 3-4: 1 weak example or very vague examples; poor integration; questionable relevance
      - 1-2: No examples or entirely irrelevant examples

      Evaluate: Sufficient number (2-3 minimum)? Quality and relevance? Specificity (concrete vs vague)? Variety (personal, historical, hypothetical, current events)? Effective placement?

      E. TIME MANAGEMENT (0-10)
      Scoring Guide:
      - 9-10: Perfect allocation; balanced points; no rushing; optimal length (4-5 min)
      - 7-8: Good allocation; mostly balanced; minor pacing issues; acceptable length
      - 5-6: Unbalanced sections; some rushing; length issues (too short/long)
      - 3-4: Poor allocation; significant rushing or dragging; major length issues
      - 1-2: Severe time issues; extremely unbalanced; inappropriate length

      Evaluate: Appropriate time allocation (intro 20-30s, body 4-5min, conclusion 20-30s)? Balanced development of main points? Not rushing through critical sections? Finishing within optimal range? Pacing appropriate for length?

      ═══════════════════════════════════════════════════════════════════════════════

      5. DELIVERY ANALYSIS (30%)

      A. VOCAL VARIETY (0-10)
      Scoring Guide:
      - 9-10: Highly dynamic voice; excellent tone/pitch/volume variation; engaging emotional expression
      - 7-8: Good variety; clear modulation; appropriate expression; minor monotone sections
      - 5-6: Some variety; mostly consistent tone; limited modulation; somewhat flat
      - 3-4: Limited variety; mostly monotone; little modulation; flat expression
      - 1-2: Entirely monotone; no variety; disengaged vocal delivery

      Evaluate: Tone changes for emphasis? Pitch modulation (not monotone)? Volume variation? Energy and emotional expression? Strategic vocal pacing?

      B. PACING (0-10)
      Scoring Guide:
      - 9-10: Perfect pacing (140-160 WPM); strategic pauses; comfortable tempo throughout
      - 7-8: Good pacing; minor speed issues; mostly strategic pauses; generally comfortable
      - 5-6: Acceptable pacing; somewhat too fast/slow; few pauses; some sections rushed
      - 3-4: Poor pacing; significantly too fast/slow; no pauses; difficult to follow
      - 1-2: Extreme pacing issues; unintelligible due to speed; no audience consideration

      Evaluate: Calculate WPM from transcript (words ÷ duration in minutes). Optimal 140-160 WPM. Too fast (>170 WPM)? Too slow (<120 WPM)? Strategic pauses for emphasis? Rushed sections? Comfortable tempo for comprehension?

      C. ARTICULATION (0-10)
      Scoring Guide:
      - 9-10: Perfect clarity; all words crisp and audible; excellent projection; professional articulation
      - 7-8: Clear articulation; minor pronunciation issues; good projection; generally crisp
      - 5-6: Mostly clear; some mumbling; adequate projection; some dropped endings
      - 3-4: Frequent unclear words; significant mumbling; poor projection; many dropped endings
      - 1-2: Largely unintelligible; severe articulation issues; inaudible

      Evaluate: Clear pronunciation? Crisp enunciation (not mumbling)? Vocal projection (audible and clear)? Word endings pronounced (not dropped)? Overall clarity and intelligibility?

      D. FILLER WORD CONTROL (0-10)
      Scoring Guide:
      - 9-10: <3 fillers per minute; minimal impact; strong flow; excellent control
      - 7-8: 3-5 fillers per minute; minor impact; good flow; solid control
      - 5-6: 5-8 fillers per minute; noticeable impact; flow disrupted; moderate control
      - 3-4: 8-12 fillers per minute; significant impact; flow heavily disrupted; poor control
      - 1-2: >12 fillers per minute; severe impact; unintelligible sections; no control

      Evaluate: Count "um," "uh," "like," "you know," "so," "basically," etc. Calculate per-minute rate (total fillers ÷ duration in minutes). Target: <5 per minute. Pattern identification (before transitions? after breaths?). Impact on flow and credibility?

      ═══════════════════════════════════════════════════════════════════════════════

      6. LANGUAGE ANALYSIS (15%)

      A. VOCABULARY SOPHISTICATION (0-10)
      Scoring Guide:
      - 9-10: Sophisticated, precise vocabulary; excellent word variety; academic register; enhances content
      - 7-8: Strong vocabulary; good variety; mostly academic; appropriate complexity
      - 5-6: Adequate vocabulary; some repetition; mostly casual; basic word choice
      - 3-4: Limited vocabulary; significant repetition; overly casual; simple word choice
      - 1-2: Very basic vocabulary; constant repetition; inappropriate casual language

      Evaluate: Word choice complexity and precision? Academic vs casual language appropriateness? Topic-specific terminology used correctly? Avoidance of word repetition? Vocabulary elevates content vs distracts? Count key term repetitions. Note casual phrases ("stuff," "things," "a lot of," "kind of").

      B. RHETORICAL DEVICES (0-10)
      Scoring Guide:
      - 9-10: Multiple sophisticated devices; natural integration; highly effective; enhances persuasion
      - 7-8: Several devices; good integration; mostly effective; strengthens argument
      - 5-6: 1-2 basic devices; adequate use; somewhat effective; limited impact
      - 3-4: Attempted devices; poor execution; ineffective; feels forced
      - 1-2: No rhetorical devices; purely informational delivery

      Evaluate: Use of metaphors? Analogies? Rhetorical questions? Parallel structure? Rule of three? Repetition for emphasis? Contrast? Anaphora? Extract specific examples from transcript.

      C. EMOTIONAL APPEAL / PATHOS (0-10)
      Scoring Guide:
      - 9-10: Powerful emotional connection; compelling stories; genuine feeling; highly relatable; moves audience
      - 7-8: Strong emotional elements; good storytelling; relatable; creates connection
      - 5-6: Some emotional appeal; basic stories; somewhat relatable; limited connection
      - 3-4: Minimal emotional appeal; weak stories; difficult to relate; lacks feeling
      - 1-2: No emotional appeal; purely logical/informational; no connection

      Evaluate: Storytelling quality? Relatable scenarios? Evoking feeling and empathy? Personal examples that create connection? Emotional vocabulary? Tone matching emotional content?

      D. LOGICAL APPEAL / LOGOS (0-10)
      Scoring Guide:
      - 9-10: Flawless logic; clear reasoning; strong cause-effect; perfect coherence; intellectually rigorous
      - 7-8: Strong logic; good reasoning; clear connections; solid coherence; few gaps
      - 5-6: Basic logic; some reasoning; adequate connections; some gaps in coherence
      - 3-4: Weak logic; poor reasoning; unclear connections; significant gaps; hard to follow
      - 1-2: No logical structure; incoherent reasoning; no clear connections; illogical

      Evaluate: Clear reasoning chains? Cause-and-effect explanations? Logical connectors ("therefore," "because," "as a result")? Argument coherence? Evidence properly supporting claims? No logical fallacies?

      ═══════════════════════════════════════════════════════════════════════════════

      7. BODY LANGUAGE ANALYSIS (15%)

      A. EYE CONTACT (0-10)
      Scoring Guide:
      - 9-10: >85% eye contact; excellent scanning; natural; strong connection; minimal note-checking
      - 7-8: 75-85% eye contact; good scanning; mostly natural; solid connection; some note-checking
      - 5-6: 60-75% eye contact; uneven scanning; somewhat forced; inconsistent connection
      - 3-4: 40-60% eye contact; poor scanning; obviously forced; weak connection
      - 1-2: <40% eye contact; staring at notes/floor; no connection

      Evaluate: Estimate percentage of time making eye contact (target >75%). Scanning pattern (not staring at one spot)? Not looking at notes excessively? Natural, not forced? Connection with audience maintained? Note specific timestamps when eye contact dropped during important moments.

      B. GESTURES (0-10)
      Scoring Guide:
      - 9-10: Natural, purposeful gestures; excellent variety; perfectly timed; enhances message; confident
      - 7-8: Good gestures; appropriate variety; mostly well-timed; supports message; mostly natural
      - 5-6: Some gestures; limited variety; somewhat awkward; minimal enhancement
      - 3-4: Few gestures or distracting movements; repetitive; poor timing; detracts from message
      - 1-2: No gestures (frozen) or extremely distracting; inappropriate; undermines credibility

      Evaluate: Purposeful vs distracting? Variety of gestures? Natural, not forced or rehearsed? Emphasis timing (gestures match verbal emphasis)? Hand positioning (above waist, open)? Avoid: fig-leafing, hands in pockets, repetitive movements.

      C. POSTURE & STANCE (0-10)
      Scoring Guide:
      - 9-10: Upright, confident posture; professional stance; strong presence; no swaying; grounded
      - 7-8: Good posture; mostly upright; solid stance; minor movement; generally confident
      - 5-6: Adequate posture; some slouching; some swaying; somewhat uncertain stance
      - 3-4: Poor posture; significant slouching; excessive swaying; weak presence; unstable stance
      - 1-2: Severe posture issues; collapsed stance; constant movement; no presence

      Evaluate: Upright, not slouching? Confident, not uncertain? Professional presence? Feet shoulder-width apart, grounded? Not swaying or rocking? Shoulders back? Weight balanced?

      D. STAGE PRESENCE (0-10)
      Scoring Guide:
      - 9-10: Commanding presence; excellent energy; supreme confidence; authority; complete audience ownership
      - 7-8: Strong presence; good energy; confident; solid authority; good audience connection
      - 5-6: Moderate presence; adequate energy; somewhat confident; limited authority
      - 3-4: Weak presence; low energy; uncertain; little authority; poor audience connection
      - 1-2: No presence; no energy; nervous/fearful; no authority; disconnected from audience

      Evaluate: Confidence level? Energy and enthusiasm? Comfort level on stage? Authority and credibility? Audience connection and engagement? Facial expressions matching tone? Genuine, animated, avoiding blank expression?

      ═══════════════════════════════════════════════════════════════════════════════

      8. STRUCTURE BREAKDOWN
      Analyze speech structure with precise time ranges:

      - Introduction (target 20-30s, max 45s): Hook quality? Thesis clarity? Point preview (roadmap)? Engagement?
      - Body Points (target 4-5min total): Identify EACH distinct main point/argument (typically 2-3 points)
        * Provide separate timeRange and assessment for EACH body point
        * Evaluate transitions, balance, example placement, logical flow for each point
        * Note if points are unbalanced (first point 90 seconds, second point 45 seconds = problem)
      - Conclusion (target 20-30s, max 45s): Recap of points? Return to thesis? Memorable closer? No new points introduced? Definitive ending?

      Flag if intro or conclusion exceeds 45 seconds (too long for speech length).

      ═══════════════════════════════════════════════════════════════════════════════

      9. COMPETITIVE CONTEXT & ACTIONABLE FEEDBACK
      
      Provide tournament-level assessment:
      - Performance Tier: Assign one tier: Finals / Semifinals / Quarterfinals / Local / Developing
      - Tournament Readiness: Boolean (Yes/No)
      - Priority Improvements: Rank top 3 issues by competitive impact
      - Strengths: List 3-5 specific strengths (not generic praise)
      - Practice Drill: One concrete drill for next session
      - Next Session Focus: One primary goal + measurable metric

      ═══════════════════════════════════════════════════════════════════════════════

      10. JSON OUTPUT FORMAT:
      Return valid JSON matching this EXACT structure:
      {
        "transcript": "[full transcription of speech]",
        "overallScore": 6.5,
        "performanceTier": "Quarterfinals",
        "tournamentReady": false,
        "categoryScores": {
          "content": {"score": 6.2, "weight": 0.40, "weighted": 2.48},
          "delivery": {"score": 7.0, "weight": 0.30, "weighted": 2.10},
          "language": {"score": 5.8, "weight": 0.15, "weighted": 0.87},
          "bodyLanguage": {"score": 6.5, "weight": 0.15, "weighted": 0.98}
        },
        "contentAnalysis": {
          "topicAdherence": {"score": 7, "feedback": "[Use detailed template from Section 2]"},
          "argumentStructure": {"score": 6, "feedback": "[Use detailed template from Section 2]"},
          "depthOfAnalysis": {"score": 5, "feedback": "[Use detailed template from Section 2]"},
          "examplesEvidence": {"score": 6, "feedback": "[Use detailed template from Section 2]"},
          "timeManagement": {"score": 7, "feedback": "[Use detailed template from Section 2]"}
        },
        "deliveryAnalysis": {
          "vocalVariety": {"score": 6, "feedback": "[Use detailed template from Section 2]"},
          "pacing": {"score": 5, "wpm": 178, "feedback": "[Use detailed template from Section 2]"},
          "articulation": {"score": 7, "feedback": "[Use detailed template from Section 2]"},
          "fillerWords": {"score": 4, "total": 47, "perMinute": 11.1, "breakdown": {"um": 18, "uh": 12, "like": 11, "you know": 6}, "feedback": "[Use detailed template from Section 2]"}
        },
        "languageAnalysis": {
          "vocabulary": {"score": 5, "feedback": "[Use detailed template from Section 2]"},
          "rhetoricalDevices": {"score": 6, "examples": ["metaphor at 1:45", "rule of three at 3:20"], "feedback": "[Use detailed template from Section 2]"},
          "emotionalAppeal": {"score": 7, "feedback": "[Use detailed template from Section 2]"},
          "logicalAppeal": {"score": 6, "feedback": "[Use detailed template from Section 2]"}
        },
        "bodyLanguageAnalysis": {
          "eyeContact": {"score": 4, "percentage": 45, "feedback": "[Use detailed template from Section 2]"},
          "gestures": {"score": 6, "feedback": "[Use detailed template from Section 2]"},
          "posture": {"score": 7, "feedback": "[Use detailed template from Section 2]"},
          "stagePresence": {"score": 6, "feedback": "[Use detailed template from Section 2]"}
        },
        "speechStats": {
          "duration": "string",
          "wordCount": 0,
          "wpm": 0,
          "fillerWordCount": 0,
          "fillerWordRate": 0.0
        },
        "structureAnalysis": {
          "introduction": {"timeRange": "0:00-0:25", "assessment": "Strong hook with clear thesis"},
          "bodyPoints": [
            {"timeRange": "0:25-1:40", "assessment": "First main point with evidence"},
            {"timeRange": "1:40-3:00", "assessment": "Second point builds on first"},
            {"timeRange": "3:00-4:35", "assessment": "Final argument ties together"}
          ],
          "conclusion": {"timeRange": "4:35-5:00", "assessment": "Memorable closing statement"}
        },
        "priorityImprovements": [
          {"priority": 1, "issue": "string", "action": "string", "impact": "string"}
        ],
        "strengths": ["string"],
        "practiceDrill": "string",
        "nextSessionFocus": {"primary": "string", "metric": "string"}
      }

      CRITICAL: Each "feedback" field in the JSON must follow the detailed template structure from Section 2:
      
      **Score Justification:** [2-3 sentences explaining the score]
      
      **Evidence from Speech:**
      - [Example 1 with timestamp]
      - [Example 2 with timestamp]
      - [Example 3 with timestamp, if applicable]
      
      **What This Means:** [1-2 sentences interpreting the evidence]
      
      **How to Improve:**
      1. [Specific, actionable recommendation with concrete example]
      2. [Second recommendation with example]
      3. [Third recommendation, if applicable]
      
      11. TONE REQUIREMENTS:
      - Professional and direct (not casual or overly friendly)
      - Specific and technical (never vague - always cite timestamps, WPM, percentages, counts)
      - Constructive but honest (no sugarcoating - competitive debaters need truth)
      - Use competitive debate terminology (e.g., "roadmap," "signposting," "refutation," "impact")
      - Reference NSDA standards and tournament-level expectations
      - Comparative context (e.g., "This argument would work at local tournaments but needs sophistication for quarters+")
      - Focus on ACTIONABLE steps (what EXACTLY to practice, not just "do better")
      - Evidence-based (every criticism must have timestamp/quote; every score must be justified)
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for long speeches

    console.log(`   🚀 Dispatching analysis to OpenRouter (Model: ${modelName})`);
    console.log(`   📦 Data URL size: ${(base64Video.length / (1024 * 1024)).toFixed(2)} MB`);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173", 
        "X-Title": "Ballot Championship Coach",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "video_url",
                video_url: {
                  url: base64Video,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" }, 
        temperature: 0.1, // Lower temperature for surgical precision in technical analysis
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log(`   ↩️  OpenRouter response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error body');
      console.error(`   ❌ OpenRouter Error (${response.status}):`, errorText);
      
      let errorMessage = 'Unknown API Error';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch (e) {
        errorMessage = `API Error ${response.status}`;
      }
      
      // Always include status for debuggability.
      throw new Error(`OpenRouter ${response.status}: ${errorMessage}`);
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content;

    if (!resultText) {
      throw new Error("Empty response from model.");
    }

    const analysis = JSON.parse(resultText);
    const transcript = analysis.transcript || '';
    
    // Remove transcript from the nested analysis object if it's there
    if (analysis.transcript) {
      delete analysis.transcript;
    }

    // Backend truth: recompute duration + derived stats and guard against hallucinated ballots.
    const durationSecondsActual = await getVideoDurationSeconds(input.videoPath);
    const transcriptWordCount = countWords(transcript);

    // If the model returned no transcript (or extremely short), do NOT trust any detailed scoring.
    if (transcriptWordCount < 25) {
      const reason =
        transcriptWordCount === 0
          ? 'No transcript was produced (audio missing or prolonged silence).'
          : `Transcript too short to score competitively (${transcriptWordCount} words).`;

      console.warn(`⚠️ Insufficient speech detected. Returning guarded analysis. Reason: ${reason}`);

      return {
        success: true,
        transcript,
        analysis: buildInsufficientSpeechAnalysis(durationSecondsActual, reason),
      };
    }

    const { total: fillerTotal, breakdown: fillerBreakdown } = countFillers(transcript);
    const wpm = Math.round((transcriptWordCount / Math.max(durationSecondsActual, 1)) * 60);
    const fillerPerMinute = Number(((fillerTotal / Math.max(durationSecondsActual, 1)) * 60).toFixed(1));

    // Override model-provided speechStats with measured values for UI correctness.
    analysis.speechStats = {
      duration: formatDurationSeconds(durationSecondsActual),
      wordCount: transcriptWordCount,
      wpm,
      fillerWordCount: fillerTotal,
      fillerWordRate: fillerPerMinute,
    };

    // Keep delivery pacing + filler word metrics aligned with computed values.
    if (analysis.deliveryAnalysis?.pacing) {
      analysis.deliveryAnalysis.pacing.wpm = wpm;
    }
    if (analysis.deliveryAnalysis?.fillerWords) {
      analysis.deliveryAnalysis.fillerWords.total = fillerTotal;
      analysis.deliveryAnalysis.fillerWords.perMinute = fillerPerMinute;
      analysis.deliveryAnalysis.fillerWords.breakdown = fillerBreakdown;
    }

    // Ensure we always provide at least 2 priority improvements (high-ROI refinements),
    // even if the model returns too few.
    ensureMinPriorityImprovements(analysis, 2);
    
    console.log('✅ Analysis successful!');
    return {
      success: true,
      transcript,
      analysis,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Analysis failed:', msg);
    if (error instanceof Error && (error as any).cause) {
      console.error('   Cause:', (error as any).cause);
    }
    return {
      success: false,
      transcript: '',
      error: msg,
    };
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(getApiKey());
}

export function getGeminiStatus(): { configured: boolean; model: string } {
  return {
    configured: isGeminiConfigured(),
    model: getModel(),
  };
}
