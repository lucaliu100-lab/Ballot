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
  /**
   * Optional duration hint (seconds) supplied by the client at upload time.
   * Used only as a fallback when ffprobe cannot determine duration from the container metadata.
   */
  durationSecondsHint?: number;
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

type MediaStreamInfo = {
  hasAudio: boolean;
  hasVideo: boolean;
  audioCodec?: string;
  videoCodec?: string;
};

async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function getMediaStreamInfo(filePath: string): Promise<MediaStreamInfo> {
  return await new Promise<MediaStreamInfo>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const streams: any[] = Array.isArray((metadata as any)?.streams) ? (metadata as any).streams : [];
      const audio = streams.find((s) => s?.codec_type === 'audio');
      const video = streams.find((s) => s?.codec_type === 'video');
      resolve({
        hasAudio: Boolean(audio),
        hasVideo: Boolean(video),
        audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : undefined,
        videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : undefined,
      });
    });
  });
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

function parseDurationStringToSeconds(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // If it's a plain number string.
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;

  // Common ffprobe tag formats:
  // - "00:01:23.45"
  // - "0:01:23.45"
  // - "01:23.45"
  // - "00:01:23"
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (nums.length === 3) {
      [hours, minutes, seconds] = nums;
    } else {
      [minutes, seconds] = nums;
    }
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total > 0 ? total : null;
  }

  return null;
}

async function getVideoDurationSecondsRobust(filePath: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);

      // 1) Best-case: format.duration (number).
      const fmtDur = metadata?.format?.duration;
      if (typeof fmtDur === 'number' && Number.isFinite(fmtDur) && fmtDur > 0) {
        return resolve(fmtDur);
      }

      // 2) Streams may contain duration as number or string.
      const streams: any[] = Array.isArray((metadata as any)?.streams) ? (metadata as any).streams : [];
      for (const st of streams) {
        const stDur = st?.duration;
        if (typeof stDur === 'number' && Number.isFinite(stDur) && stDur > 0) return resolve(stDur);
        if (typeof stDur === 'string') {
          const parsed = parseDurationStringToSeconds(stDur);
          if (parsed && parsed > 0) return resolve(parsed);
        }
        const tagDur =
          (typeof st?.tags?.DURATION === 'string' && st.tags.DURATION) ||
          (typeof st?.tags?.duration === 'string' && st.tags.duration);
        if (typeof tagDur === 'string') {
          const parsed = parseDurationStringToSeconds(tagDur);
          if (parsed && parsed > 0) return resolve(parsed);
        }
      }

      // 3) Container tags sometimes store DURATION
      const fmtTagDur =
        (typeof (metadata as any)?.format?.tags?.DURATION === 'string' && (metadata as any).format.tags.DURATION) ||
        (typeof (metadata as any)?.format?.tags?.duration === 'string' && (metadata as any).format.tags.duration);
      if (typeof fmtTagDur === 'string') {
        const parsed = parseDurationStringToSeconds(fmtTagDur);
        if (parsed && parsed > 0) return resolve(parsed);
      }

      return reject(new Error('Unable to determine video duration.'));
    });
  });
}

function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function buildEstimatedTimecodedTranscript(transcript: string, durationSeconds: number, wordsPerChunk: number = 36): string {
  const t = String(transcript || '').trim();
  if (!t) return '';
  const dur = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const chunkSize = Math.max(12, Math.floor(wordsPerChunk));
  const totalWords = words.length;
  const lines: string[] = [];

  for (let start = 0; start < totalWords; start += chunkSize) {
    const end = Math.min(totalWords, start + chunkSize);
    const textChunk = words.slice(start, end).join(' ');

    // Estimate time range proportional to word index.
    const startSec = dur > 0 ? (start / totalWords) * dur : 0;
    const endSec = dur > 0 ? (end / totalWords) * dur : 0;
    const label = dur > 0 ? `[${formatTimecode(startSec)}-${formatTimecode(endSec)}]` : `[?:??-?:??]`;

    lines.push(`${label} ${textChunk}`);
  }

  return lines.join('\n');
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function normalizeAnalysisScoringInPlace(analysis: any): void {
  if (!analysis || typeof analysis !== 'object') return;

  // Detect if model returned scores on 0–100 or 0–1 scale.
  const collected: number[] = [];
  const collect = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'score' || k === 'overallScore') {
        if (typeof v === 'number' && Number.isFinite(v)) collected.push(v);
      } else if (v && typeof v === 'object') {
        collect(v);
      }
    }
  };
  collect(analysis);

  const maxScore = collected.length ? Math.max(...collected) : 10;
  const factor = maxScore > 10 ? 0.1 : (maxScore > 0 && maxScore <= 1.2 ? 10 : 1);

  const norm = (v: any): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    return clamp(round1(n * factor), 0, 10);
  };

  // Normalize all nested ".score" fields.
  const normalizeScores = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'score') {
        (obj as any)[k] = norm(v);
      } else if (v && typeof v === 'object') {
        normalizeScores(v);
      }
    }
  };
  normalizeScores(analysis);

  // Normalize overallScore separately (and then recompute from category weights for consistency).
  analysis.overallScore = norm(analysis.overallScore);

  // Normalize eye contact percentage if model returned 0–1.
  if (analysis.bodyLanguageAnalysis?.eyeContact) {
    const p = analysis.bodyLanguageAnalysis.eyeContact.percentage;
    if (typeof p === 'number' && Number.isFinite(p)) {
      const pct = p <= 1.2 ? p * 100 : p;
      analysis.bodyLanguageAnalysis.eyeContact.percentage = clamp(Math.round(pct), 0, 100);
    }
  }

  // Recompute category weighted + overall score (prevents 65.0/10 UI bugs).
  const cs = analysis.categoryScores;
  if (cs && typeof cs === 'object') {
    const normalizeCat = (key: string, weight: number) => {
      const c = cs[key];
      if (!c || typeof c !== 'object') return;
      c.score = norm(c.score);
      c.weight = typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : weight;
      c.weighted = round1(c.score * c.weight);
    };
    normalizeCat('content', 0.4);
    normalizeCat('delivery', 0.3);
    normalizeCat('language', 0.15);
    normalizeCat('bodyLanguage', 0.15);
    const sum =
      (cs.content?.weighted || 0) +
      (cs.delivery?.weighted || 0) +
      (cs.language?.weighted || 0) +
      (cs.bodyLanguage?.weighted || 0);
    analysis.overallScore = clamp(round1(sum), 0, 10);
  }
}

// ==============================
// NSDA-calibrated rubric enforcement (server-side truth)
// ==============================

function computePerformanceTier(overallScore10: number): string {
  const s = overallScore10;
  // Keep tiers simple and aligned to NSDA-calibrated rubric ranges.
  // 9.0+ Finals caliber, 8.0+ breaking range, 7.7+ early competitive, else developing.
  if (s >= 9.0) return 'Finals';
  if (s >= 8.0) return 'Breaking';
  if (s >= 7.7) return 'Competitive';
  return 'Developing';
}

function applyLengthPenaltiesInPlace(analysis: any, durationSeconds: number): void {
  if (!analysis || typeof analysis !== 'object') return;
  const dur = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  if (dur <= 0) return;

  // Penalties from nsda-calibrated-rubric.md:
  // <3:00 → -2.0 to Content + flag
  // 3:00-3:59 → -1.0 to Content + note
  // >7:00 → -0.5 to Time Management + flag
  let contentPenalty = 0;
  let timeMgmtPenalty = 0;
  let note = '';
  if (dur < 180) {
    contentPenalty = 2.0;
    note = '⚠️ INSUFFICIENT LENGTH (<3:00): Content score penalty applied.';
  } else if (dur < 240) {
    contentPenalty = 1.0;
    note = 'Below optimal range (3:00–3:59): Content score penalty applied.';
  } else if (dur > 420) {
    timeMgmtPenalty = 0.5;
    note = '⚠️ EXCEEDS LIMIT (>7:00): Time Management penalty applied.';
  }

  (analysis as any).__rubric = {
    ...(analysis as any).__rubric,
    // We keep category scores as the raw averages of the displayed subscores.
    // Apply any short-length penalty ONLY as an overall deduction so the wheels remain mathematically consistent.
    overallLengthDeduction: contentPenalty > 0 ? round1(contentPenalty * 0.4) : 0,
    overallLengthDeductionReason: contentPenalty > 0 ? 'suboptimal length' : '',
    lengthPenaltyNote: note,
  };

  if (timeMgmtPenalty > 0 && analysis.contentAnalysis?.timeManagement) {
    analysis.contentAnalysis.timeManagement.score = clamp(round1((analysis.contentAnalysis.timeManagement.score || 0) - timeMgmtPenalty), 0, 10);
  }

  if (note) {
    // Append note to time management feedback so users see why a score moved.
    const tm = analysis.contentAnalysis?.timeManagement;
    if (tm && typeof tm.feedback === 'string' && !tm.feedback.includes(note)) {
      tm.feedback = `${tm.feedback}\n\n${note}`.trim();
    }
  }
}

function avg(nums: Array<number | undefined>): number {
  const values = nums.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeCategoryScoresFromSubscoresInPlace(analysis: any): void {
  if (!analysis || typeof analysis !== 'object') return;
  const cs = analysis.categoryScores;
  if (!cs || typeof cs !== 'object') return;

  // IMPORTANT: These must match exactly what the UI displays in FeedbackReport:
  // - Content: Topic Adherence, Argument Structure, Depth of Analysis (3)
  // - Delivery: Vocal Variety, Pacing (2)
  // - Language: Vocabulary, Rhetorical Devices (2)
  // - Body: Eye Contact, Gestures (2)
  const contentAvg = avg([
    analysis.contentAnalysis?.topicAdherence?.score,
    analysis.contentAnalysis?.argumentStructure?.score,
    analysis.contentAnalysis?.depthOfAnalysis?.score,
  ]);
  const deliveryAvg = avg([
    analysis.deliveryAnalysis?.vocalVariety?.score,
    analysis.deliveryAnalysis?.pacing?.score,
  ]);
  const languageAvg = avg([
    analysis.languageAnalysis?.vocabulary?.score,
    analysis.languageAnalysis?.rhetoricalDevices?.score,
  ]);
  const bodyAvg = avg([
    analysis.bodyLanguageAnalysis?.eyeContact?.score,
    analysis.bodyLanguageAnalysis?.gestures?.score,
  ]);

  cs.content.score = clamp(round1(contentAvg), 0, 10);
  cs.delivery.score = clamp(round1(deliveryAvg), 0, 10);
  cs.language.score = clamp(round1(languageAvg), 0, 10);
  cs.bodyLanguage.score = clamp(round1(bodyAvg), 0, 10);

  // Ensure weights and weighted totals are consistent.
  cs.content.weight = 0.4;
  cs.delivery.weight = 0.3;
  cs.language.weight = 0.15;
  cs.bodyLanguage.weight = 0.15;
  cs.content.weighted = round1(cs.content.score * cs.content.weight);
  cs.delivery.weighted = round1(cs.delivery.score * cs.delivery.weight);
  cs.language.weighted = round1(cs.language.score * cs.language.weight);
  cs.bodyLanguage.weighted = round1(cs.bodyLanguage.score * cs.bodyLanguage.weight);
  analysis.overallScore = clamp(round1(cs.content.weighted + cs.delivery.weighted + cs.language.weighted + cs.bodyLanguage.weighted), 0, 10);
}

function enforceTournamentReadinessInPlace(analysis: any, durationSeconds: number, fillerPerMinute: number, eyeContactPct?: number): void {
  if (!analysis || typeof analysis !== 'object') return;
  const overall = typeof analysis.overallScore === 'number' ? analysis.overallScore : 0;
  const cs = analysis.categoryScores || {};
  const minCat = Math.min(
    cs.content?.score ?? 0,
    cs.delivery?.score ?? 0,
    cs.language?.score ?? 0,
    cs.bodyLanguage?.score ?? 0
  );
  const durOk = durationSeconds >= 240 && durationSeconds <= 420; // 4:00-7:00
  const fillersOk = Number.isFinite(fillerPerMinute) ? fillerPerMinute < 8 : true;
  const eyeOk = typeof eyeContactPct === 'number' ? eyeContactPct > 50 : true;

  analysis.tournamentReady = Boolean(overall >= 7.5 && minCat >= 7.0 && durOk && fillersOk && eyeOk);
  analysis.performanceTier = computePerformanceTier(overall);
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

function estimateWavDurationSecondsFromBytes(bytes: number): number {
  // We write WAV as PCM 16-bit mono @ 16kHz => 16,000 samples/sec * 2 bytes/sample = 32,000 bytes/sec
  // WAV header is ~44 bytes; subtract for better estimate, but clamp at 0.
  const payloadBytes = Math.max(0, bytes - 44);
  return payloadBytes / 32000;
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

async function extractAudioWavForAnalysis(inputVideoPath: string): Promise<string> {
  const dir = path.resolve(__dirname, '../temp/audio');
  await ensureDir(dir);
  const base = path.basename(inputVideoPath).replace(/\.[^.]+$/, '');
  const outPath = path.join(dir, `${base}-audio.wav`);

  // If we already created an audio file for this recording, reuse it.
  try {
    const stats = await fs.promises.stat(outPath);
    if (stats.size > 1024) return outPath;
  } catch {
    // ignore
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputVideoPath)
      .noVideo()
      // WAV PCM is widely compatible for STT
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outPath);
  });

  return outPath;
}

async function encodeAudioToBase64(audioPath: string): Promise<string> {
  const audioBuffer = await fs.promises.readFile(audioPath);
  return audioBuffer.toString('base64');
}

function getTranscribeModelCandidates(primary: string | undefined, judgeModel: string): string[] {
  const candidates = [
    primary,
    process.env.TRANSCRIBE_MODEL_FALLBACK,
    // Widely supported on OpenRouter for audio transcription; safe default if not configured.
    'openai/whisper-large-v3',
    judgeModel,
  ].filter((x): x is string => Boolean(x && String(x).trim()));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return candidates.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

async function getAudioDurationSeconds(audioPath: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration;
      if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
        return resolve(duration);
      }
      return reject(new Error('Unable to determine audio duration.'));
    });
  });
}

async function splitAudioIntoChunks(audioPath: string, chunkSeconds: number): Promise<string[]> {
  const safeChunk = Math.max(5, Math.floor(chunkSeconds));
  const base = path.basename(audioPath).replace(/\.[^.]+$/, '');
  const chunksDir = path.resolve(__dirname, '../temp/audio_chunks', base);
  await ensureDir(chunksDir);

  // Reuse existing chunks if already present.
  try {
    const existing = await fs.promises.readdir(chunksDir);
    const wavs = existing
      .filter((f) => f.toLowerCase().endsWith('.wav'))
      .map((f) => path.join(chunksDir, f))
      .sort();
    if (wavs.length > 0) return wavs;
  } catch {
    // ignore
  }

  const outPattern = path.join(chunksDir, `${base}-chunk-%03d.wav`);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(audioPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      // Segment into fixed-length chunks
      .outputOptions(['-f', 'segment', '-segment_time', String(safeChunk), '-reset_timestamps', '1'])
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outPattern);
  });

  const files = await fs.promises.readdir(chunksDir);
  return files
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .map((f) => path.join(chunksDir, f))
    .sort();
}

async function callOpenRouterJson(params: {
  apiKey: string;
  model: string;
  content: any[];
  maxTokens: number;
}): Promise<any> {
  const { apiKey, model, content, maxTokens } = params;

  const controller = new AbortController();
  // Frontend timeout is 5 minutes; keep backend under that even with retry work.
  const timeoutId = setTimeout(() => controller.abort(), 240000);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // These are metadata only for OpenRouter analytics; keep them non-secret.
      'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://ballotv1.pages.dev',
      'X-Title': 'Ballot Championship Coach',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'No error body');
    let msg = `OpenRouter ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      msg = `OpenRouter ${response.status}: ${parsed?.error?.message || parsed?.message || 'API error'}`;
    } catch {
      msg = `OpenRouter ${response.status}: API error`;
    }
    const err = new Error(msg);
    (err as any).cause = errorText;
    throw err;
  }

  const data = await response.json();
  const resultText = data.choices?.[0]?.message?.content;
  if (typeof resultText !== 'string' || !resultText.trim()) throw new Error('Empty response from model.');

  const raw = String(resultText).trim();

  const extractJsonObject = (text: string): string => {
    const t = text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first >= 0 && last > first) return t.slice(first, last + 1);
    return t;
  };

  // Repair common model mistakes: raw newlines/tabs inside JSON strings (must be escaped).
  const escapeControlCharsInStrings = (text: string): string => {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (!inString) {
        if (ch === '"') inString = true;
        out += ch;
        continue;
      }
      // inString
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        // drop; CRLF handled by \n
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      out += ch;
    }
    return out;
  };

  const tryParse = (text: string): any | null => {
    const candidate = extractJsonObject(text);
    try {
      return JSON.parse(candidate);
    } catch {
      // try repair
      try {
        return JSON.parse(escapeControlCharsInStrings(candidate));
      } catch {
        return null;
      }
    }
  };

  const parsed = tryParse(raw);
  if (parsed) return parsed;

  // One retry: ask the model to resend valid JSON only (escape newlines as \\n).
  const retryController = new AbortController();
  // Retry should be fast; it's only for formatting correction.
  const retryTimeout = setTimeout(() => retryController.abort(), 90000);
  const retryResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://ballotv1.pages.dev',
      'X-Title': 'Ballot Championship Coach',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content },
        {
          role: 'user',
          content:
            'Your previous response was invalid JSON (likely raw newlines inside strings). ' +
            'Return ONLY valid JSON. Escape all newlines inside strings as \\\\n.',
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
    signal: retryController.signal,
  });
  clearTimeout(retryTimeout);
  if (!retryResp.ok) {
    const errorText = await retryResp.text().catch(() => 'No error body');
    const err = new Error(`OpenRouter ${retryResp.status}: retry parse failed`);
    (err as any).cause = errorText;
    throw err;
  }
  const retryData = await retryResp.json();
  const retryText = retryData.choices?.[0]?.message?.content;
  if (typeof retryText === 'string' && retryText.trim()) {
    const parsedRetry = tryParse(retryText);
    if (parsedRetry) return parsedRetry;
  }

  const snippet = raw.slice(0, 500);
  throw new Error(`Model returned non-JSON content. First 500 chars: ${snippet}`);
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

function normalizePriorityImprovements(
  analysis: any,
  context: {
    durationSeconds: number;
    wpm: number;
    fillerTotal: number;
    fillerPerMinute: number;
    eyeContactPercentage?: number;
  }
): void {
  if (!analysis || typeof analysis !== 'object') return;

  const safeNumber = (v: any, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const durationSeconds = safeNumber(context.durationSeconds, 0);
  const isTooShort = durationSeconds > 0 && durationSeconds < 240; // < 4:00 gets "length below optimal"; <3:00 is especially critical.

  const fillerTotal = safeNumber(context.fillerTotal, 0);
  const fillerPerMinute = safeNumber(context.fillerPerMinute, 0);
  const wpm = safeNumber(context.wpm, 0);
  const eyeContactPct =
    typeof context.eyeContactPercentage === 'number' && Number.isFinite(context.eyeContactPercentage)
      ? context.eyeContactPercentage
      : undefined;

  const existingRaw: any[] = Array.isArray(analysis.priorityImprovements) ? analysis.priorityImprovements : [];

  const normalizeItem = (x: any) => {
    if (!x || typeof x !== 'object') return null;
    const issue = typeof x.issue === 'string' ? x.issue.trim() : '';
    const action = typeof x.action === 'string' ? x.action.trim() : '';
    const impact = typeof x.impact === 'string' ? x.impact.trim() : '';
    if (!issue || !action || !impact) return null;
    return { issue, action, impact };
  };

  const looksLikeFiller = (text: string) => /\b(filler|fillers|um|uh|like|you know|basically|actually|literally)\b/i.test(text);
  const looksLikeEyeContact = (text: string) => /\b(eye contact|look(ing)? up|gaze|staring at notes|audience contact)\b/i.test(text);
  const looksLikePacing = (text: string) => /\b(pace|pacing|too fast|too slow|speed|wpm|words per minute)\b/i.test(text);
  const looksLikeLength = (text: string) => /\b(length|too short|insufficient length|time limit|time management|minutes?)\b/i.test(text);

  // Prefer not to recommend fillers/eye contact/pacing when stats show those are already fine.
  const shouldSuppressFiller = fillerTotal === 0 || fillerPerMinute < 3;
  const shouldSuppressEyeContact = typeof eyeContactPct === 'number' && eyeContactPct >= 75;
  const shouldSuppressPacing = wpm >= 130 && wpm <= 170; // generous "fine" band; we want top-3 to target true gaps.

  const filteredExisting = existingRaw
    .map(normalizeItem)
    .filter(Boolean)
    .filter((x: any) => {
      const text = `${x.issue} ${x.action} ${x.impact}`;
      if (shouldSuppressFiller && looksLikeFiller(text)) return false;
      if (shouldSuppressEyeContact && looksLikeEyeContact(text)) return false;
      if (shouldSuppressPacing && looksLikePacing(text)) return false;
      return true;
    }) as Array<{ issue: string; action: string; impact: string }>;

  const items: Array<{ issue: string; action: string; impact: string }> = [];

  // Rule: If length is below optimal/insufficient, it must be priority #1.
  if (isTooShort) {
    const durationLabel = durationSeconds > 0 ? formatDurationSeconds(durationSeconds) : 'unknown';
    items.push({
      issue: 'Insufficient competitive length',
      action:
        durationSeconds < 180
          ? `Re-record to ≥3:00 (optimal 4:00–6:00). Your speech length (${durationLabel}) is too short to demonstrate competitive depth.`
          : `Extend to 4:00–6:00 and allocate time across 2–3 body points (intro ~0:20–0:30, conclusion ~0:20–0:30). Current length: ${durationLabel}.`,
      impact: 'Enables depth, multiple developed points, and judgeable structure under NSDA expectations.',
    });
  }

  // Keep remaining valid model-provided items (avoid duplicates / avoid pushing length twice).
  for (const x of filteredExisting) {
    if (items.length >= 3) break;
    if (isTooShort && looksLikeLength(`${x.issue} ${x.action} ${x.impact}`)) continue;
    if (items.some((y) => y.issue.toLowerCase() === x.issue.toLowerCase())) continue;
    items.push(x);
  }

  // If we still need more, choose based on lowest sub-scores (largest gaps).
  const scoreMap: Array<{ key: string; score: number }> = [];
  const pushScore = (key: string, score: any) => scoreMap.push({ key, score: safeNumber(score, 10) });

  try {
    pushScore('content.argumentStructure', analysis.contentAnalysis?.argumentStructure?.score);
    pushScore('content.depthOfAnalysis', analysis.contentAnalysis?.depthOfAnalysis?.score);
    pushScore('content.examplesEvidence', analysis.contentAnalysis?.examplesEvidence?.score);
    pushScore('content.topicAdherence', analysis.contentAnalysis?.topicAdherence?.score);
    pushScore('content.timeManagement', analysis.contentAnalysis?.timeManagement?.score);

    pushScore('delivery.vocalVariety', analysis.deliveryAnalysis?.vocalVariety?.score);
    pushScore('delivery.pacing', analysis.deliveryAnalysis?.pacing?.score);
    pushScore('delivery.articulation', analysis.deliveryAnalysis?.articulation?.score);
    pushScore('delivery.fillerWords', analysis.deliveryAnalysis?.fillerWords?.score);

    pushScore('language.vocabulary', analysis.languageAnalysis?.vocabulary?.score);
    pushScore('language.rhetoricalDevices', analysis.languageAnalysis?.rhetoricalDevices?.score);
    pushScore('language.emotionalAppeal', analysis.languageAnalysis?.emotionalAppeal?.score);
    pushScore('language.logicalAppeal', analysis.languageAnalysis?.logicalAppeal?.score);

    pushScore('body.eyeContact', analysis.bodyLanguageAnalysis?.eyeContact?.score);
    pushScore('body.gestures', analysis.bodyLanguageAnalysis?.gestures?.score);
    pushScore('body.posture', analysis.bodyLanguageAnalysis?.posture?.score);
    pushScore('body.stagePresence', analysis.bodyLanguageAnalysis?.stagePresence?.score);
  } catch {
    // ignore
  }

  const templates: Record<string, { issue: string; action: string; impact: string }> = {
    'content.argumentStructure': {
      issue: 'Weak argument structure (roadmap + signposting)',
      action: 'Use a 10-second roadmap in the intro (“I’ll prove this in 3 ways…”) and label each body point with explicit transitions.',
      impact: 'Improves judge flow immediately and makes your reasoning feel intentional and tournament-ready.',
    },
    'content.depthOfAnalysis': {
      issue: 'Surface-level analysis (needs warrants)',
      action: 'For each claim, add 2 “because” warrants and one counter-consideration (“Some might say…, but…”).',
      impact: 'Raises sophistication from local-level assertions to quarters+ analytical depth.',
    },
    'content.examplesEvidence': {
      issue: 'Examples are not specific enough',
      action: 'Add 1 concrete example per point (name/place/event) and explain explicitly how it proves the claim in one sentence.',
      impact: 'Boosts credibility and makes arguments harder to dismiss on ballots.',
    },
    'content.topicAdherence': {
      issue: 'Thesis drift / weak quote linkage',
      action: 'End each body point with a 1-sentence link-back: “This proves the quote because…”.',
      impact: 'Prevents tangents and keeps the judge convinced you answered the prompt.',
    },
    'content.timeManagement': {
      issue: 'Time allocation is unbalanced',
      action: 'Target: intro 0:20–0:30, each body point ~1:15–1:45, conclusion 0:20–0:30. Practice with a timer and planned transitions.',
      impact: 'Stops rushing and allows full development of your best arguments.',
    },
    'delivery.vocalVariety': {
      issue: 'Vocal variety is too flat (energy + emphasis)',
      action: 'Mark 3 emphasis words per point and deliberately vary volume/pitch on them; add 1 purposeful pause before each transition.',
      impact: 'Improves engagement and makes key lines land like “finals” speakers.',
    },
    'delivery.pacing': {
      issue: 'Pacing is outside competitive comfort',
      action: 'Aim for 140–160 WPM with 1–2s pauses at transitions and after thesis; rehearse transitions slowly.',
      impact: 'Increases clarity and perceived confidence under judge flow.',
    },
    'delivery.articulation': {
      issue: 'Articulation clarity is inconsistent',
      action: 'Do 60 seconds of “over-enunciate” drills daily; slow down on dense lines and hit word endings.',
      impact: 'Prevents lost arguments due to comprehension issues.',
    },
    'delivery.fillerWords': {
      issue: 'Filler words disrupt authority',
      action: 'Replace fillers with silent 1-second pauses—practice “pause instead of um” during transitions and after breaths.',
      impact: 'Makes you sound controlled and credible to tournament judges.',
    },
    'language.vocabulary': {
      issue: 'Vocabulary lacks precision/variety',
      action: 'During prep, write 5 synonyms for your thesis keyword and use 1 higher-register term per point.',
      impact: 'Elevates tone and reduces repetitive, casual phrasing.',
    },
    'language.rhetoricalDevices': {
      issue: 'Rhetorical techniques are underused',
      action: 'Add 1 device per speech: rule of three, contrast, metaphor, or rhetorical question—script the line during prep.',
      impact: 'Improves memorability and persuasion beyond pure explanation.',
    },
    'language.emotionalAppeal': {
      issue: 'Emotional appeal is under-developed',
      action: 'Add one vivid human-stakes sentence per point (who is affected, what changes, why it matters).',
      impact: 'Increases persuasion and audience connection in ballot decisions.',
    },
    'language.logicalAppeal': {
      issue: 'Logical chain is not explicit enough',
      action: 'Use signpost logic words (“because,” “therefore,” “as a result”) and restate the warrant after each example.',
      impact: 'Makes your reasoning judge-proof and harder to poke holes in.',
    },
    'body.eyeContact': {
      issue: 'Eye contact is below competitive standard',
      action: 'Memorize thesis + closing line and use keyword-only notes; enforce a 5-second max look-down rule.',
      impact: 'Improves authority and judge connection in key ballot moments.',
    },
    'body.gestures': {
      issue: 'Gestures are distracting or too limited',
      action: 'Keep hands above waist and use purposeful gestures only on key claims; eliminate repetitive fidgeting.',
      impact: 'Improves presence and makes delivery feel intentional.',
    },
    'body.posture': {
      issue: 'Posture/stance reduces confidence',
      action: 'Adopt a grounded stance (feet shoulder-width) and practice delivering transitions without swaying.',
      impact: 'Increases perceived confidence and steadiness under pressure.',
    },
    'body.stagePresence': {
      issue: 'Stage presence lacks authority',
      action: 'Increase energy on thesis/closer; pair strong eye contact with a deliberate pause before key lines.',
      impact: 'Moves you from “good” to “tournament-ready” presence.',
    },
  };

      // Explicitly sort to find the lowest score to target the biggest weakness
      scoreMap.sort((a, b) => a.score - b.score);
      
      // Update Practice Drill to specifically target the lowest scoring area
      if (scoreMap.length > 0) {
        const lowest = scoreMap[0];
        // Only override if the lowest score is actually low (e.g., < 7) to avoid "fixing" good things
        if (lowest.score < 7.0) {
           const drillTemplate = templates[lowest.key];
           if (drillTemplate) {
             analysis.practiceDrill = `Targeting your biggest gap (${lowest.key.split('.')[1]} - Score: ${lowest.score}): ${drillTemplate.action}`;
             analysis.nextSessionFocus.primary = `Improve ${lowest.key.split('.')[1]}`;
             analysis.nextSessionFocus.metric = `Score > ${lowest.score + 1}`;
           }
        }
      }

  const alreadyCoversKey = (key: string) => {
    const t = templates[key];
    if (!t) return false;
    const signature = t.issue.toLowerCase();
    return items.some((x) => x.issue.toLowerCase() === signature);
  };

  // Select the biggest gaps, but respect suppression rules.
  scoreMap.sort((a, b) => a.score - b.score);
  for (const s of scoreMap) {
    if (items.length >= 3) break;
    const t = templates[s.key];
    if (!t) continue;
    const text = `${t.issue} ${t.action} ${t.impact}`;
    if (shouldSuppressFiller && looksLikeFiller(text)) continue;
    if (shouldSuppressEyeContact && looksLikeEyeContact(text)) continue;
    if (shouldSuppressPacing && looksLikePacing(text)) continue;
    if (isTooShort && looksLikeLength(text)) continue;
    if (alreadyCoversKey(s.key)) continue;
    if (items.some((x) => x.issue.toLowerCase() === t.issue.toLowerCase())) continue;
    items.push(t);
  }

  // Finally, write back as ranked priorities (1..n).
  analysis.priorityImprovements = items.slice(0, 3).map((x, idx) => ({
    priority: idx + 1,
    issue: x.issue,
    action: x.action,
    impact: x.impact,
  }));
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
  console.log(`   API Key present: ${apiKey ? 'Yes' : 'No'}`);
  console.log(`   Video path: ${input.videoPath}`);

  try {
    // Duration robustness:
    // Some browser-recorded WebM files may have missing/odd container duration metadata.
    // We try multiple ffprobe fields, optionally transcode, and finally fall back to client hint.
    let durationSeconds: number | null = null;
    try {
      durationSeconds = await getVideoDurationSecondsRobust(input.videoPath);
    } catch (e) {
      console.warn(`⚠️ ffprobe could not determine duration for ${path.basename(input.videoPath)}. Attempting transcode fallback...`);
      try {
        const transcoded = await transcodeVideoForAnalysis(input.videoPath);
        durationSeconds = await getVideoDurationSecondsRobust(transcoded);
        console.log(`   🎞️  Duration recovered from transcoded file: ${formatDurationSeconds(durationSeconds)}`);
      } catch (e2) {
        const hint = typeof input.durationSecondsHint === 'number' && Number.isFinite(input.durationSecondsHint) && input.durationSecondsHint > 0
          ? input.durationSecondsHint
          : null;
        if (hint) {
          durationSeconds = hint;
          console.warn(`⚠️ Using client-reported durationSecondsHint=${hint}s as fallback.`);
        } else {
          // Last resort: proceed without failing the entire analysis.
          durationSeconds = 0;
          console.warn('⚠️ Proceeding with durationSeconds=0 (unknown). Stats will be approximate.');
        }
      }
    }

    console.log(`   🎞️  Video duration (best available): ${durationSeconds > 0 ? formatDurationSeconds(durationSeconds) : 'Unknown'}`);

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

    // Inspect streams to validate that the recording actually has audio.
    const streamInfo = await getMediaStreamInfo(videoPathForAnalysis).catch((e) => {
      console.error('⚠️ getMediaStreamInfo failed:', e instanceof Error ? e.message : String(e));
      return null;
    });
    
    if (streamInfo) {
      console.log(
        `   🎛️ Streams: audio=${streamInfo.hasAudio ? `yes(${streamInfo.audioCodec || 'unknown'})` : 'no'} ` +
          `video=${streamInfo.hasVideo ? `yes(${streamInfo.videoCodec || 'unknown'})` : 'no'}`
      );
    } else {
      console.warn('⚠️ Could not determine stream info - will attempt transcription anyway');
    }

    if (streamInfo && !streamInfo.hasAudio) {
      const reason = 'No audio stream detected in recording (microphone permissions or browser recording settings).';
      console.error(`❌ BLOCKING: ${reason}`);
      console.error(`   Video file: ${path.basename(videoPathForAnalysis)}, size: ${originalSizeMb.toFixed(2)} MB`);
      return {
        success: true,
        transcript: '',
        analysis: buildInsufficientSpeechAnalysis(durationSeconds || 0, reason),
      };
    }

    // ----------------------------
    // Step 1) Transcribe audio only
    // ----------------------------
    const audioPath = await extractAudioWavForAnalysis(videoPathForAnalysis);
    const audioDurationSeconds = await getAudioDurationSeconds(audioPath).catch(() => 0);
    const audioBase64 = await encodeAudioToBase64(audioPath);
    console.log(
      `   🔊 Audio extracted: ${path.basename(audioPath)} (${(audioBase64.length / (1024 * 1024)).toFixed(2)} MB base64)` +
        (audioDurationSeconds > 0 ? `, duration=${formatDurationSeconds(audioDurationSeconds)}` : '')
    );

    const transcribePrompt = `
You are a speech-to-text transcription engine.
Transcribe the spoken audio as accurately as possible.

Rules:
- Return ONLY valid JSON: {"transcript":"..."}
- If no usable speech is present, return {"transcript":""}
- Do not add commentary, headings, or extra keys.
    `.trim();

    const transcribeModels = getTranscribeModelCandidates(process.env.TRANSCRIBE_MODEL, modelName);
    const tryTranscribeBase64WithModel = async (model: string, b64: string): Promise<string> => {
      // Try OpenAI-style audio part first.
      try {
        const t = await callOpenRouterJson({
          apiKey,
          model,
          content: [
            { type: 'text', text: transcribePrompt },
            { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
          ],
          maxTokens: 4000, // Increased from 2500 to handle longer speeches
        });
        return typeof t?.transcript === 'string' ? t.transcript : '';
      } catch (e) {
        // Fallback: some providers expect audio_url data URL
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`⚠️ input_audio transcription failed for model=${model} (${msg}). Retrying with audio_url...`);
        const t = await callOpenRouterJson({
          apiKey,
          model,
          content: [
            { type: 'text', text: transcribePrompt },
            { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${b64}` } },
          ],
          maxTokens: 4000, // Increased from 2500 to handle longer speeches
        });
        return typeof t?.transcript === 'string' ? t.transcript : '';
      }
    };

    const transcribeWithFallback = async (b64: string): Promise<{ transcript: string; modelUsed: string }> => {
      let lastModel = transcribeModels[transcribeModels.length - 1] || modelName;
      for (const m of transcribeModels) {
        lastModel = m;
        try {
          const txt = (await tryTranscribeBase64WithModel(m, b64)).trim();
          if (txt) return { transcript: txt, modelUsed: m };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`⚠️ Transcription attempt failed for model=${m} (${msg})`);
        }
      }
      return { transcript: '', modelUsed: lastModel };
    };

    const { transcript: firstTranscript, modelUsed: transcribeModelUsed } = await transcribeWithFallback(audioBase64);
    let transcript = firstTranscript.trim();
    let transcriptWordCount = countWords(transcript);
    console.log(`   📝 Transcript words (single-pass): ${transcriptWordCount} [model=${transcribeModelUsed}]`);
    console.log(`   📝 Transcript preview (first 100 chars): "${transcript.substring(0, 100)}..."`);

    // Some providers/models only transcribe the first N seconds of audio.
    // If we have a long recording but got a tiny transcript, retry by chunking.
    const audioBytes = await fs.promises.stat(audioPath).then((s) => s.size).catch(() => 0);
    const audioDurationEstimated = audioBytes > 0 ? estimateWavDurationSecondsFromBytes(audioBytes) : 0;
    const audioDurationBest = audioDurationSeconds > 0 ? audioDurationSeconds : audioDurationEstimated;
    console.log(
      `   📝 Audio base64 size: ${(audioBase64.length / 1024).toFixed(1)} KB` +
        (audioDurationBest > 0 ? `, duration: ${formatDurationSeconds(audioDurationBest)}` : '')
    );
    const shouldTryChunking =
      transcriptWordCount < 25 &&
      audioDurationBest >= 20;

    if (shouldTryChunking) {
      const chunkSeconds = Number(process.env.TRANSCRIBE_CHUNK_SECONDS || 30);
      console.warn(
        `⚠️ Transcript seems truncated (${transcriptWordCount} words, audio=${formatDurationSeconds(audioDurationBest)}). ` +
          `Retrying transcription in ~${Math.max(5, Math.floor(chunkSeconds))}s chunks...`
      );

      try {
        const chunkPaths = await splitAudioIntoChunks(audioPath, chunkSeconds);
        const parts: string[] = [];
        for (let i = 0; i < chunkPaths.length; i++) {
          const p = chunkPaths[i];
          const b64 = await encodeAudioToBase64(p);
          const { transcript: chunkText } = await transcribeWithFallback(b64);
          if (chunkText) parts.push(chunkText);
        }
        const combined = parts.join(' ').replace(/\s+/g, ' ').trim();
        const combinedWc = countWords(combined);
        console.log(`   📝 Transcript words (chunked): ${combinedWc}`);
        if (combinedWc > transcriptWordCount) {
          transcript = combined;
          transcriptWordCount = combinedWc;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`⚠️ Chunked transcription failed (${msg}). Proceeding with single-pass transcript.`);
      }
    }

    // If transcript is too short, return guarded analysis early.
    if (transcriptWordCount < 25) {
      const reason =
        transcriptWordCount === 0
          ? 'No transcript was produced (audio missing or prolonged silence).'
          : `Transcript too short to score competitively (${transcriptWordCount} words).`;
      console.warn(`⚠️ Insufficient speech detected. Returning guarded analysis. Reason: ${reason}`);
      const durationSecondsActual =
        durationSeconds && durationSeconds > 0 ? durationSeconds : (input.durationSecondsHint || 0);
      return {
        success: true,
        transcript,
        analysis: buildInsufficientSpeechAnalysis(durationSecondsActual, reason),
      };
    }

    // ----------------------------
    // Step 2) Judge using transcript (+ optional video)
    // ----------------------------
    // Video payloads can massively increase latency/cost for longer recordings.
    // Default: include video only up to MAX_VIDEO_SECONDS_FOR_ANALYSIS (180s) unless explicitly disabled.
    const maxVideoSeconds = Number(process.env.MAX_VIDEO_SECONDS_FOR_ANALYSIS || 180);
    const includeVideo =
      process.env.INCLUDE_VIDEO_IN_ANALYSIS !== 'false' &&
      durationSeconds > 0 &&
      Number.isFinite(maxVideoSeconds) &&
      maxVideoSeconds > 0 &&
      durationSeconds <= maxVideoSeconds;
    const base64Video = includeVideo ? await encodeVideoToBase64(videoPathForAnalysis) : null;
    if (base64Video) {
      console.log(`   📹 Video encoded (Base64 length: ${base64Video.length})`);
    } else {
      console.log(
        `   📹 Video omitted (${process.env.INCLUDE_VIDEO_IN_ANALYSIS === 'false' ? 'INCLUDE_VIDEO_IN_ANALYSIS=false' : `duration>${Number.isFinite(maxVideoSeconds) ? maxVideoSeconds : 180}s`})`
      );
    }

    const transcriptTimecoded = buildEstimatedTimecodedTranscript(transcript, durationSeconds, 36);

    const judgePrompt = `
You are a professional NSDA impromptu judge for BALLOT, an elite debate training platform.
Analyze this competitive impromptu speech with surgical precision.

NSDA-CALIBRATED RUBRIC (MUST FOLLOW):
- Scoring is 0.0–10.0 (one decimal). This corresponds to NSDA 30-point speaker points mapping:
  - 8.0–8.5 is an average competitive high school debater (roughly 24–25.5 NSDA).
  - 9.0+ is rare and indicates finals-caliber execution.
- LENGTH PENALTIES (applied to Content score):
  - <3:00 → -2.0 + flag "⚠️ INSUFFICIENT LENGTH"
  - 3:00–3:59 → -1.0 + note "Below optimal range"
  - 4:00–6:00 → no penalty (optimal)
  - >7:00 → -0.5 to Time Management + flag "⚠️ EXCEEDS LIMIT"
- WEIGHTED FORMULA:
  Overall = (Content × 0.40) + (Delivery × 0.30) + (Language × 0.15) + (Body Language × 0.15)
- Tournament readiness criteria (set tournamentReady=true ONLY if all hold):
  - overallScore ≥ 7.5
  - no category score < 7.0
  - speech length 4:00–7:00
  - filler rate < 8/min
  - eye contact > 50%

THEME: ${input.theme}
QUOTE: ${input.quote}
VIDEO_DURATION_SECONDS (best available): ${Math.round(durationSeconds)}
VIDEO_DURATION (mm:ss, best available): ${durationSeconds > 0 ? formatDurationSeconds(durationSeconds) : 'Unknown'}

TRANSCRIPT (verbatim, do not invent beyond this):
"""
${transcript}
"""

TRANSCRIPT WITH ESTIMATED TIME-CODES (USE THESE FOR ALL TIME RANGES):
${transcriptTimecoded ? `"""` : '""'}
${transcriptTimecoded}
${transcriptTimecoded ? `"""` : '""'}

CRITICAL ANTI-HALLUCINATION RULES (MUST FOLLOW):
- Do NOT invent transcript content, evidence, timestamps, or structure.
- Use the transcript for all evidence quotes.
- For time ranges, ONLY use the bracketed time ranges provided in TRANSCRIPT WITH ESTIMATED TIME-CODES.
- If transcript is too short, say so explicitly and return minimal evaluation.

FEEDBACK FORMAT RULE (MUST FOLLOW FOR EVERY feedback STRING IN THE JSON):
Each feedback string MUST follow this exact markdown template (always include all sections; do not rename headings):
**Score Justification:** 2–4 sentences summarizing what the speaker did and their level (novice/developing/varsity/national).

**Evidence from Speech:**
- <short quote from transcript (NO double-quotes)> [m:ss-m:ss]
- <short quote from transcript (NO double-quotes)> [m:ss-m:ss]
- <short quote from transcript (NO double-quotes)> [m:ss-m:ss]

**What This Means:** 1–2 sentences explaining the competitive implication for an NSDA ballot.

**How to Improve:**
1. One concrete drill or adjustment.
2. One concrete drill or adjustment.
3. One concrete drill or adjustment.

JSON VALIDITY RULE (CRITICAL):
- The entire response must be valid JSON.
- Do NOT include raw line breaks or unescaped quotes inside JSON strings.
- NEVER use the " character inside any feedback text. If you must quote the speaker, use single quotes instead.

SCORING RULES:
- ALL scores are on a 0.0–10.0 scale (one decimal max). Never use 0–100.
- categoryScores.*.weighted must equal score * weight.
- overallScore must equal the sum of the four weighted category scores.

Return ONLY valid JSON matching this structure (NO transcript field; transcript is provided above):
{
  "overallScore": 0,
  "performanceTier": "string",
  "tournamentReady": false,
  "categoryScores": {
    "content": {"score": 0, "weight": 0.40, "weighted": 0},
    "delivery": {"score": 0, "weight": 0.30, "weighted": 0},
    "language": {"score": 0, "weight": 0.15, "weighted": 0},
    "bodyLanguage": {"score": 0, "weight": 0.15, "weighted": 0}
  },
  "contentAnalysis": {
    "topicAdherence": {"score": 0, "feedback": "string"},
    "argumentStructure": {"score": 0, "feedback": "string"},
    "depthOfAnalysis": {"score": 0, "feedback": "string"},
    "examplesEvidence": {"score": 0, "feedback": "string"},
    "timeManagement": {"score": 0, "feedback": "string"}
  },
  "deliveryAnalysis": {
    "vocalVariety": {"score": 0, "feedback": "string"},
    "pacing": {"score": 0, "wpm": 0, "feedback": "string"},
    "articulation": {"score": 0, "feedback": "string"},
    "fillerWords": {"score": 0, "total": 0, "perMinute": 0, "breakdown": {}, "feedback": "string"}
  },
  "languageAnalysis": {
    "vocabulary": {"score": 0, "feedback": "string"},
    "rhetoricalDevices": {"score": 0, "examples": [], "feedback": "string"},
    "emotionalAppeal": {"score": 0, "feedback": "string"},
    "logicalAppeal": {"score": 0, "feedback": "string"}
  },
  "bodyLanguageAnalysis": {
    "eyeContact": {"score": 0, "percentage": 0, "feedback": "string"},
    "gestures": {"score": 0, "feedback": "string"},
    "posture": {"score": 0, "feedback": "string"},
    "stagePresence": {"score": 0, "feedback": "string"}
  },
  "speechStats": {
    "duration": "string",
    "wordCount": 0,
    "wpm": 0,
    "fillerWordCount": 0,
    "fillerWordRate": 0
  },
  "structureAnalysis": {
    "introduction": {"timeRange": "string", "assessment": "string"},
    "bodyPoints": [{"timeRange": "string", "assessment": "string"}],
    "conclusion": {"timeRange": "string", "assessment": "string"}
  },
  "priorityImprovements": [{"priority": 1, "issue": "string", "action": "string", "impact": "string"}],
  "strengths": ["string"],
  "practiceDrill": "string",
  "nextSessionFocus": {"primary": "string", "metric": "string"}
}
    `.trim();

    const analysis = await callOpenRouterJson({
      apiKey,
      model: modelName,
      content: base64Video
        ? [
            { type: 'text', text: judgePrompt },
            { type: 'video_url', video_url: { url: base64Video } },
          ]
        : [{ type: 'text', text: judgePrompt }],
      maxTokens: 7000,
    });

    // Normalize any model-returned scoring scale quirks (0–100 or 0–1) and recompute weighted totals.
    normalizeAnalysisScoringInPlace(analysis);

    // Backend truth: recompute duration + derived stats and guard against hallucinated ballots.
    // Use the same best-available duration for stats, but keep an independent attempt for safety.
    let durationSecondsActual = durationSeconds;
    if (!durationSecondsActual || durationSecondsActual <= 0) {
      try {
        durationSecondsActual = await getVideoDurationSecondsRobust(input.videoPath);
      } catch {
        const hint = typeof input.durationSecondsHint === 'number' && Number.isFinite(input.durationSecondsHint) && input.durationSecondsHint > 0
          ? input.durationSecondsHint
          : 0;
        durationSecondsActual = hint;
      }
    }
    // Defensive: if model still returned a transcript field, ignore it (we already have the audio transcript).
    if (analysis && typeof analysis === 'object' && (analysis as any).transcript) {
      delete (analysis as any).transcript;
    }

    const transcriptWordCount2 = countWords(transcript);

    const { total: fillerTotal, breakdown: fillerBreakdown } = countFillers(transcript);
    const wpm = Math.round((transcriptWordCount2 / Math.max(durationSecondsActual, 1)) * 60);
    const fillerPerMinute = Number(((fillerTotal / Math.max(durationSecondsActual, 1)) * 60).toFixed(1));

    // Override model-provided speechStats with measured values for UI correctness.
    analysis.speechStats = {
      duration: formatDurationSeconds(durationSecondsActual),
      wordCount: transcriptWordCount2,
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

    // Apply rubric length penalties and enforce rubric-derived tournament readiness + tier.
    applyLengthPenaltiesInPlace(analysis, durationSecondsActual);
    // Ensure category scores are consistent with the detailed sub-scores (prevents “subscores high but category low” mismatches).
    computeCategoryScoresFromSubscoresInPlace(analysis);

    // Apply any short-length penalty as an overall deduction (category wheels remain pure averages).
    const overallLenDeduction = Number((analysis as any).__rubric?.overallLengthDeduction || 0);
    if (overallLenDeduction > 0) {
      analysis.overallScore = clamp(round1(analysis.overallScore - overallLenDeduction), 0, 10);
      // Keep tier label aligned with the adjusted overall score.
      analysis.performanceTier = computePerformanceTier(analysis.overallScore);
    }
    enforceTournamentReadinessInPlace(
      analysis,
      durationSecondsActual,
      fillerPerMinute,
      analysis.bodyLanguageAnalysis?.eyeContact?.percentage
    );

    // Priority Improvements should represent the biggest real gaps.
    // Important: do not recommend filler/eye contact/pacing fixes when metrics show they are already fine.
    normalizePriorityImprovements(analysis, {
      durationSeconds: durationSecondsActual,
      wpm,
      fillerTotal,
      fillerPerMinute,
      eyeContactPercentage: analysis.bodyLanguageAnalysis?.eyeContact?.percentage,
    });

    // Ensure we always provide at least 3 improvements (rubric requirement),
    // even if the model returns too few or filtering removes some.
    ensureMinPriorityImprovements(analysis, 3);
    
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
