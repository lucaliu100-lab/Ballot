/**
 * Gemini Client Module (via OpenRouter)
 *
 * Handles multimodal analysis (Video + Audio) using Gemini 3 Flash Preview.
 * Uses the OpenRouter API for unified model access.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

// ===========================================
// METRICS / INTEGRITY TRACKING
// ===========================================

/**
 * Transcript integrity metadata for logging and suspicious activity detection
 */
export interface TranscriptIntegrity {
  wordCount: number;
  charLen: number;
  sha256: string;
  isSuspicious: boolean;
  suspiciousReason?: string;
}

/**
 * Parse/repair metrics for tracking LLM output reliability
 */
export interface ParseMetrics {
  parseFailCount: number;
  repairUsed: boolean;
  rawOutput?: string;  // Stored when parse fails
}

// Simple in-memory sha256 frequency tracker (resets on server restart)
// In production, this should be persisted to a database
const sha256FrequencyMap = new Map<string, number>();
const SHA256_REPEAT_THRESHOLD = 3; // Flag if same hash appears 3+ times

/**
 * Compute sha256 hash of a string
 */
function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Compute transcript integrity metadata
 */
function computeTranscriptIntegrity(transcript: string): TranscriptIntegrity {
  const text = String(transcript || '').trim();
  const wordCount = countWords(text);
  const charLen = text.length;
  const hash = sha256(text);
  
  // Track hash frequency
  const currentCount = (sha256FrequencyMap.get(hash) || 0) + 1;
  sha256FrequencyMap.set(hash, currentCount);
  
  // Check for suspicious patterns
  let isSuspicious = false;
  let suspiciousReason: string | undefined;
  
  // Suspicious: same transcript hash repeating unusually often
  if (currentCount >= SHA256_REPEAT_THRESHOLD) {
    isSuspicious = true;
    suspiciousReason = `Transcript hash repeated ${currentCount} times across sessions`;
  }
  
  // Suspicious: very low word count for what should be speech
  if (wordCount > 0 && wordCount < 25) {
    isSuspicious = true;
    suspiciousReason = suspiciousReason 
      ? `${suspiciousReason}; Word count suspiciously low (${wordCount})`
      : `Word count suspiciously low (${wordCount})`;
  }
  
  // Suspicious: empty or near-empty transcript
  if (charLen > 0 && charLen < 50) {
    isSuspicious = true;
    suspiciousReason = suspiciousReason
      ? `${suspiciousReason}; Character count suspiciously low (${charLen})`
      : `Character count suspiciously low (${charLen})`;
  }
  
  return { wordCount, charLen, sha256: hash, isSuspicious, suspiciousReason };
}

// ===========================================
// CONFIGURATION
// ===========================================

function getApiKey(): string {
  // Use the OpenRouter API key from .env
  return process.env.OPENROUTER_API_KEY || '';
}

function getModel(): string {
  // Gemini 3 Flash Preview on OpenRouter - better multimodal reasoning for video analysis
  return process.env.GEMINI_MODEL || 'google/gemini-3-flash-preview';
}

// ===========================================
// TYPES
// ===========================================

/**
 * Camera framing metadata for body language assessment eligibility.
 * All three must be true for body language to be assessable.
 */
export interface FramingData {
  headVisible: boolean;
  torsoVisible: boolean;
  handsVisible: boolean;
}

/** Analysis format type */
export type AnalysisFormat = 'legacy' | 'championship-v1';

export interface GeminiAnalysisInput {
  videoPath: string;
  theme: string;
  quote: string;
  /**
   * Optional duration hint (seconds) supplied by the client at upload time.
   * Used only as a fallback when ffprobe cannot determine duration from the container metadata.
   */
  durationSecondsHint?: number;
  /**
   * Camera framing info for body language assessment eligibility.
   * If not provided or incomplete, body language defaults to NOT assessable.
   */
  framing?: FramingData;
  /**
   * Analysis format to use. Defaults to 'championship-v1' (new format).
   * 'legacy' uses the old 4-category scoring system.
   */
  format?: AnalysisFormat;
}

export interface GeminiAnalysisResult {
  success: boolean;
  transcript: string;
  analysis?: {
    classification: 'normal' | 'too_short' | 'nonsense' | 'off_topic' | 'mostly_off_topic';
    capsApplied: boolean;
    /** Whether body language can be assessed based on camera framing */
    bodyLanguageAssessable: boolean;
    overallScore: number;
    performanceTier: string;
    tournamentReady: boolean;
    categoryScores: {
      content: { score: number; weight: number; weighted: number };
      delivery: { score: number; weight: number; weighted: number };
      language: { score: number; weight: number; weighted: number };
      bodyLanguage: { score: number | null; weight: number; weighted: number | null };
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
      eyeContact: { score: number | null; percentage: number | null; feedback: string };
      gestures: { score: number | null; feedback: string };
      posture: { score: number | null; feedback: string };
      stagePresence: { score: number | null; feedback: string };
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
  /** Structured error info when parsing/validation fails */
  errorDetails?: {
    type: 'parse_failure' | 'schema_validation' | 'model_error' | 'transcription_error';
    message: string;
    rawModelOutput?: string;
  };
  /** Transcript integrity metadata for logging */
  transcriptIntegrity?: TranscriptIntegrity;
  /** Parse/repair metrics */
  parseMetrics?: ParseMetrics;
  /** Warning about analysis quality (e.g., video compression failed, used audio-only) */
  analysisWarning?: string;
}

// ===========================================
// CHAMPIONSHIP-V1 TYPES
// ===========================================

/** Evidence types for championship format */
export interface ChampionshipEvidence {
  id: string;
  type: 'QUOTE' | 'METRIC';
  label: 'STRENGTH' | 'GAP';
  quote?: string;
  timeRange?: string;
  metric?: { name: string; value: number; unit: string };
  warrant: string;
}

/** Lever drill structure */
export interface LeverDrill {
  name: string;
  steps: [string, string, string];
  goal: string;
}

/** Ranked lever (fix recommendation) */
export interface ChampionshipLever {
  rank: number;
  name: string;
  estimatedScoreGain: string;
  patternName: string;
  diagnosis: string;
  judgeImpact: string;
  evidenceIds: string[];
  fixRule: string;
  coachQuestions: string[];
  sayThisInstead: [string, string];
  counterexampleKit: { counterexampleLine: string; resolutionLine: string };
  drill: LeverDrill;
}

/** Micro-rewrite */
export interface ChampionshipMicroRewrite {
  before: { quote: string; timeRange: string };
  after: string;
  whyStronger: string;
  evidenceIds: string[];
}

/** Checklist item */
export interface ChecklistItem {
  step: number;
  instruction: string;
  successCriteria: string;
}

/** Championship analysis result */
export interface ChampionshipAnalysis {
  version: 'championship-v1';
  meta: {
    roundType: string;
    theme: string;
    quote: string;
    model: string;
    generatedAt: string;
  };
  classification: {
    label: 'normal' | 'too_short' | 'nonsense' | 'off_topic' | 'mostly_off_topic';
    capsApplied: boolean;
    maxOverallScore: number | null;
    reasons: string[];
  };
  speechRecord: { transcript: string; timecodeNote: string };
  speechStats: {
    durationSec: number;
    durationText: string;
    wordCount: number;
    wpm: number;
    fillerWordCount: number;
    fillerPerMin: number;
    pausesPerMin: number | null;
  };
  scoring: {
    weights: { argumentStructure: number; depthWeighing: number; rhetoricLanguage: number };
    categoryScores: {
      argumentStructure: { score: number; weighted: number };
      depthWeighing: { score: number; weighted: number };
      rhetoricLanguage: { score: number; weighted: number };
    };
    overallScore: number;
    performanceTier: string;
    tournamentReady: boolean;
  };
  rfd: {
    summary: string;
    whyThisScore: Array<{ claim: string; evidenceIds: string[] }>;
    whyNotHigher: {
      nextBand: string;
      blockers: Array<{ blocker: string; evidenceIds: string[] }>;
    };
  };
  evidence: ChampionshipEvidence[];
  levers: ChampionshipLever[];
  microRewrites: ChampionshipMicroRewrite[];
  deliveryMetricsCoaching: {
    snapshot: { wpm: number; fillerPerMin: number; durationText: string; wordCount: number; pausesPerMin: number | null };
    drill: LeverDrill;
  };
  actionPlan: {
    nextRoundChecklist: [ChecklistItem, ChecklistItem, ChecklistItem];
    warmup5Min: [string, string, string];
    duringSpeechCues: [string, string];
    postRoundReview: [string, string, string];
  };
  warnings: string[];
}

/** Result type that can include either legacy or championship analysis */
export interface GeminiChampionshipResult {
  success: boolean;
  transcript: string;
  championshipAnalysis?: ChampionshipAnalysis;
  error?: string;
  errorDetails?: {
    type: 'parse_failure' | 'schema_validation' | 'model_error' | 'transcription_error';
    message: string;
    rawModelOutput?: string;
  };
  transcriptIntegrity?: TranscriptIntegrity;
  parseMetrics?: ParseMetrics;
  analysisWarning?: string;
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

function enforceTournamentReadinessInPlace(analysis: any, durationSeconds: number, fillerPerMinute: number, eyeContactPct?: number, bodyLanguageAssessable: boolean = true): void {
  if (!analysis || typeof analysis !== 'object') return;
  const overall = typeof analysis.overallScore === 'number' ? analysis.overallScore : 0;
  const cs = analysis.categoryScores || {};
  
  // For tournament readiness, only consider body language if it's assessable
  const minCat = bodyLanguageAssessable
    ? Math.min(
        cs.content?.score ?? 0,
        cs.delivery?.score ?? 0,
        cs.language?.score ?? 0,
        cs.bodyLanguage?.score ?? 0
      )
    : Math.min(
        cs.content?.score ?? 0,
        cs.delivery?.score ?? 0,
        cs.language?.score ?? 0
      );
  const durOk = durationSeconds >= 240 && durationSeconds <= 420; // 4:00-7:00
  const fillersOk = Number.isFinite(fillerPerMinute) ? fillerPerMinute < 8 : true;
  // If body language is not assessable, skip eye contact check
  const eyeOk = !bodyLanguageAssessable || (typeof eyeContactPct === 'number' ? eyeContactPct > 50 : true);

  analysis.tournamentReady = Boolean(overall >= 7.5 && minCat >= 7.0 && durOk && fillersOk && eyeOk);
  analysis.performanceTier = computePerformanceTier(overall);
}

// ==============================
// Body Language Assessability (camera framing check)
// ==============================

const NOT_ASSESSABLE_FEEDBACK = 'Not assessable due to camera framing. Please record with head + hands + torso visible.';

/**
 * Determine if body language can be assessed based on camera framing.
 * All three (head, torso, hands) must be explicitly marked visible.
 */
function isBodyLanguageAssessable(framing?: FramingData): boolean {
  if (!framing) return false;
  return framing.headVisible === true && framing.torsoVisible === true && framing.handsVisible === true;
}

/**
 * Apply body language not-assessable state to analysis.
 * Sets all body language scores to null and renormalizes weights.
 */
function applyBodyLanguageNotAssessableInPlace(analysis: any): void {
  if (!analysis || typeof analysis !== 'object') return;

  analysis.bodyLanguageAssessable = false;

  // Set all body language analysis scores to null with standard feedback
  if (analysis.bodyLanguageAnalysis) {
    analysis.bodyLanguageAnalysis.eyeContact = {
      score: null,
      percentage: null,
      feedback: NOT_ASSESSABLE_FEEDBACK,
    };
    analysis.bodyLanguageAnalysis.gestures = {
      score: null,
      feedback: NOT_ASSESSABLE_FEEDBACK,
    };
    analysis.bodyLanguageAnalysis.posture = {
      score: null,
      feedback: NOT_ASSESSABLE_FEEDBACK,
    };
    analysis.bodyLanguageAnalysis.stagePresence = {
      score: null,
      feedback: NOT_ASSESSABLE_FEEDBACK,
    };
  }

  // Set category score to null
  if (analysis.categoryScores?.bodyLanguage) {
    analysis.categoryScores.bodyLanguage.score = null;
    analysis.categoryScores.bodyLanguage.weighted = null;
  }

  // Renormalize weights: redistribute body language's 15% among remaining categories
  // Original: Content 40%, Delivery 30%, Language 15%, Body 15%
  // New: Content ~47.06%, Delivery ~35.29%, Language ~17.65% (sum = 100%)
  // Simplified: Content 0.47, Delivery 0.35, Language 0.18
  const cs = analysis.categoryScores;
  if (cs) {
    const contentScore = cs.content?.score ?? 0;
    const deliveryScore = cs.delivery?.score ?? 0;
    const languageScore = cs.language?.score ?? 0;

    // Renormalize weights (0.40 + 0.30 + 0.15 = 0.85, scale to 1.0)
    const scaleFactor = 1 / 0.85;
    const newContentWeight = round1(0.40 * scaleFactor * 100) / 100; // ~0.47
    const newDeliveryWeight = round1(0.30 * scaleFactor * 100) / 100; // ~0.35
    const newLanguageWeight = round1(0.15 * scaleFactor * 100) / 100; // ~0.18

    cs.content.weight = newContentWeight;
    cs.content.weighted = round1(contentScore * newContentWeight);
    
    cs.delivery.weight = newDeliveryWeight;
    cs.delivery.weighted = round1(deliveryScore * newDeliveryWeight);
    
    cs.language.weight = newLanguageWeight;
    cs.language.weighted = round1(languageScore * newLanguageWeight);
    
    cs.bodyLanguage.weight = 0;
    cs.bodyLanguage.weighted = null;

    // Recompute overall score from renormalized weights
    const newOverall = cs.content.weighted + cs.delivery.weighted + cs.language.weighted;
    analysis.overallScore = clamp(round1(newOverall), 0, 10);
  }
}

// ==============================
// Classification-based hard caps enforcement (server-side truth)
// ==============================

type SpeechClassification = 'normal' | 'too_short' | 'nonsense' | 'off_topic' | 'mostly_off_topic';

/**
 * Deterministic heuristic classification of transcript quality BEFORE calling judge LLM.
 * Returns classification + whether to skip LLM entirely + max score cap.
 */
interface HeuristicClassificationResult {
  classification: SpeechClassification;
  skipLLM: boolean;
  maxOverallScore: number;
  reason: string;
}

function classifyTranscriptHeuristic(
  transcript: string,
  theme: string,
  quote: string
): HeuristicClassificationResult {
  const text = String(transcript || '').trim().toLowerCase();
  const wordCount = countWords(transcript);
  const charLen = text.length;
  
  // RULE 1: too_short if wordCount < 25
  if (wordCount < 25) {
    return {
      classification: 'too_short',
      skipLLM: true,
      maxOverallScore: 2.5,
      reason: `Transcript too short: ${wordCount} words (minimum 25 required)`,
    };
  }
  
  // RULE 2: cap overall <= 3.0 if wordCount < 75 (per Criteria)
  // Don't skip LLM, but enforce cap
  const lowWordCountCap = wordCount < 75;
  
  // RULE 3: nonsense detection via lexical diversity and n-gram repetition
  const words = text.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words);
  const lexicalDiversity = uniqueWords.size / words.length;
  
  // Check for high repetition of n-grams (bigrams and trigrams)
  const bigrams: Record<string, number> = {};
  const trigrams: Record<string, number> = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    bigrams[bigram] = (bigrams[bigram] || 0) + 1;
    if (i < words.length - 2) {
      const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      trigrams[trigram] = (trigrams[trigram] || 0) + 1;
    }
  }
  
  // Count highly repeated n-grams (3+ repetitions)
  const repeatedBigrams = Object.values(bigrams).filter(c => c >= 3).length;
  const repeatedTrigrams = Object.values(trigrams).filter(c => c >= 3).length;
  const totalNgrams = Object.keys(bigrams).length + Object.keys(trigrams).length;
  const repetitionRatio = totalNgrams > 0 
    ? (repeatedBigrams + repeatedTrigrams * 2) / totalNgrams 
    : 0;
  
  // Check for non-words (strings that don't look like English)
  // Simple heuristic: too many short repeated strings or strings with unusual characters
  const nonWordPattern = /^[^aeiou]{5,}$|^(.)\1{3,}$/;
  const nonWordCount = words.filter(w => nonWordPattern.test(w) || w.length > 20).length;
  const nonWordRatio = nonWordCount / words.length;
  
  // Nonsense criteria: very low lexical diversity OR high n-gram repetition OR many non-words
  if (lexicalDiversity < 0.15 && words.length > 50) {
    return {
      classification: 'nonsense',
      skipLLM: true,
      maxOverallScore: 2.5,
      reason: `Very low lexical diversity (${(lexicalDiversity * 100).toFixed(1)}% unique words)`,
    };
  }
  
  if (repetitionRatio > 0.3 && words.length > 50) {
    return {
      classification: 'nonsense',
      skipLLM: true,
      maxOverallScore: 2.5,
      reason: `High n-gram repetition detected (${(repetitionRatio * 100).toFixed(1)}% repeated patterns)`,
    };
  }
  
  if (nonWordRatio > 0.2 && words.length > 30) {
    return {
      classification: 'nonsense',
      skipLLM: true,
      maxOverallScore: 2.5,
      reason: `High non-word ratio (${(nonWordRatio * 100).toFixed(1)}% non-words)`,
    };
  }
  
  // RULE 4: off_topic / mostly_off_topic detection via keyword overlap
  // Extract keywords from theme and quote
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'then', 'once', 'here',
    'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or',
    'because', 'as', 'until', 'while', 'although', 'however', 'this',
    'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our',
    'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it',
    'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    'what', 'which', 'who', 'whom', 'whose', 'about', 'said', 'says',
  ]);
  
  const extractKeywords = (input: string): Set<string> => {
    return new Set(
      input
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
  };
  
  const themeKeywords = extractKeywords(theme);
  const quoteKeywords = extractKeywords(quote);
  const topicKeywords = new Set([...themeKeywords, ...quoteKeywords]);
  const transcriptKeywords = extractKeywords(transcript);
  
  // Calculate keyword overlap
  let overlapCount = 0;
  for (const kw of topicKeywords) {
    if (transcriptKeywords.has(kw)) overlapCount++;
    // Also check for stemmed/partial matches (simple approach)
    for (const tw of transcriptKeywords) {
      if (tw.includes(kw) || kw.includes(tw)) {
        overlapCount += 0.5;
        break;
      }
    }
  }
  
  const overlapRatio = topicKeywords.size > 0 
    ? overlapCount / topicKeywords.size 
    : 1; // If no topic keywords, assume on-topic
  
  // Off-topic: extremely low overlap
  if (overlapRatio < 0.1 && topicKeywords.size >= 3 && words.length > 50) {
    return {
      classification: 'off_topic',
      skipLLM: true,
      maxOverallScore: 2.5,
      reason: `Extremely low topic relevance (${(overlapRatio * 100).toFixed(1)}% keyword overlap)`,
    };
  }
  
  // Mostly off-topic: low overlap
  if (overlapRatio < 0.25 && topicKeywords.size >= 3 && words.length > 50) {
    return {
      classification: 'mostly_off_topic',
      skipLLM: false, // Let LLM judge, but cap scores
      maxOverallScore: 6.0,
      reason: `Low topic relevance (${(overlapRatio * 100).toFixed(1)}% keyword overlap)`,
    };
  }
  
  // Apply word count cap if needed
  if (lowWordCountCap) {
    return {
      classification: 'normal',
      skipLLM: false,
      maxOverallScore: 3.0,
      reason: `Low word count (${wordCount} words) - score capped`,
    };
  }
  
  // Normal speech
  return {
    classification: 'normal',
    skipLLM: false,
    maxOverallScore: 10.0,
    reason: 'Transcript passes heuristic checks',
  };
}

function detectSpeechClassification(transcript: string, durationSeconds: number, wordCount: number): SpeechClassification {
  // too_short: under 60 seconds OR under 100 words
  if (durationSeconds < 60 || wordCount < 100) {
    return 'too_short';
  }

  // nonsense detection: check for coherence indicators
  const words = transcript.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 50) return 'too_short';

  // Count unique words ratio - word salad often has very low uniqueness due to repetition
  const uniqueWords = new Set(words);
  const uniqueRatio = uniqueWords.size / words.length;
  
  // Check for meaningful sentence connectors (not just periods)
  const hasMeaningfulStructure = /\b(because|therefore|however|although|furthermore|consequently|moreover|thus|hence|since|as a result|in conclusion|first|second|third|finally)\b/i.test(transcript);
  
  // Check for repeated gibberish patterns: same word 3+ times in a row
  const repeatedPattern = /(\b\w+\b)\s+\1\s+\1/gi;
  const repetitionMatches = transcript.match(repeatedPattern) || [];
  const hasExcessiveRepetition = repetitionMatches.length > 2;
  
  // Count how many unique words appear more than 5 times (over-repetition indicator)
  const wordCounts: Record<string, number> = {};
  for (const w of words) {
    wordCounts[w] = (wordCounts[w] || 0) + 1;
  }
  const overRepeatedWords = Object.values(wordCounts).filter(c => c > 5).length;
  const overRepetitionRatio = overRepeatedWords / uniqueWords.size;
  
  // Nonsense heuristics (any of these indicate nonsense):
  // 1. Very low unique ratio (<20%) with over 100 words
  if (uniqueRatio < 0.20 && words.length > 100) {
    return 'nonsense';
  }
  
  // 2. Excessive same-word repetition (>2 patterns of 3+ consecutive same words) without meaningful connectors
  if (hasExcessiveRepetition && !hasMeaningfulStructure) {
    return 'nonsense';
  }
  
  // 3. High over-repetition ratio (>30% of unique words appear 5+ times) without meaningful structure
  if (overRepetitionRatio > 0.30 && !hasMeaningfulStructure) {
    return 'nonsense';
  }

  // Note: off_topic and mostly_off_topic require semantic analysis against the quote/theme
  // The model performs this classification; we validate/enforce the caps server-side
  return 'normal';
}

function enforceClassificationCapsInPlace(analysis: any, transcript: string, durationSeconds: number): void {
  if (!analysis || typeof analysis !== 'object') return;

  // Get model's classification or detect server-side
  const wordCount = countWords(transcript);
  const serverClassification = detectSpeechClassification(transcript, durationSeconds, wordCount);
  
  // Use model classification if provided and valid, otherwise use server detection
  const validClassifications: SpeechClassification[] = ['normal', 'too_short', 'nonsense', 'off_topic', 'mostly_off_topic'];
  let classification: SpeechClassification = 
    validClassifications.includes(analysis.classification) ? analysis.classification : serverClassification;
  
  // Server-side override: if server detects too_short or nonsense, trust it over model
  if (serverClassification === 'too_short' || serverClassification === 'nonsense') {
    classification = serverClassification;
  }

  analysis.classification = classification;
  
  // Apply hard caps based on classification
  const capAllScores = (maxScore: number) => {
    const capScore = (obj: any, key: string) => {
      if (obj && typeof obj[key] === 'object' && typeof obj[key].score === 'number') {
        obj[key].score = Math.min(obj[key].score, maxScore);
      }
    };
    
    // Cap all subscores
    if (analysis.contentAnalysis) {
      capScore(analysis.contentAnalysis, 'topicAdherence');
      capScore(analysis.contentAnalysis, 'argumentStructure');
      capScore(analysis.contentAnalysis, 'depthOfAnalysis');
      capScore(analysis.contentAnalysis, 'examplesEvidence');
      capScore(analysis.contentAnalysis, 'timeManagement');
    }
    if (analysis.deliveryAnalysis) {
      capScore(analysis.deliveryAnalysis, 'vocalVariety');
      capScore(analysis.deliveryAnalysis, 'pacing');
      capScore(analysis.deliveryAnalysis, 'articulation');
      capScore(analysis.deliveryAnalysis, 'fillerWords');
    }
    if (analysis.languageAnalysis) {
      capScore(analysis.languageAnalysis, 'vocabulary');
      capScore(analysis.languageAnalysis, 'rhetoricalDevices');
      capScore(analysis.languageAnalysis, 'emotionalAppeal');
      capScore(analysis.languageAnalysis, 'logicalAppeal');
    }
    if (analysis.bodyLanguageAnalysis) {
      capScore(analysis.bodyLanguageAnalysis, 'eyeContact');
      capScore(analysis.bodyLanguageAnalysis, 'gestures');
      capScore(analysis.bodyLanguageAnalysis, 'posture');
      capScore(analysis.bodyLanguageAnalysis, 'stagePresence');
    }
  };

  const capContentScores = (maxScore: number) => {
    if (analysis.contentAnalysis) {
      const capScore = (key: string) => {
        if (analysis.contentAnalysis[key] && typeof analysis.contentAnalysis[key].score === 'number') {
          analysis.contentAnalysis[key].score = Math.min(analysis.contentAnalysis[key].score, maxScore);
        }
      };
      capScore('topicAdherence');
      capScore('argumentStructure');
      capScore('depthOfAnalysis');
      capScore('examplesEvidence');
      capScore('timeManagement');
    }
  };

  let capsApplied = false;
  let maxOverall = 10.0;

  switch (classification) {
    case 'too_short':
    case 'nonsense':
    case 'off_topic':
      // Hard cap: overallScore max 2.5, all category scores ≤ 3.0
      maxOverall = 2.5;
      capAllScores(3.0);
      capsApplied = true;
      console.log(`   ⚠️ Classification "${classification}" detected. Hard cap applied: max overall 2.5`);
      break;
    
    case 'mostly_off_topic':
      // Hard cap: overallScore max 6.0, content scores ≤ 5.0
      maxOverall = 6.0;
      capContentScores(5.0);
      capsApplied = true;
      console.log(`   ⚠️ Classification "mostly_off_topic" detected. Hard cap applied: max overall 6.0`);
      break;
    
    case 'normal':
    default:
      // No cap
      break;
  }

  analysis.capsApplied = capsApplied;
  
  // Enforce the overall score cap after all other processing
  if (capsApplied && typeof analysis.overallScore === 'number') {
    analysis.overallScore = Math.min(analysis.overallScore, maxOverall);
  }
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

// ===========================================
// FEEDBACK VALIDATOR (Evidence Quality Check)
// ===========================================

interface FeedbackValidationResult {
  isValid: boolean;
  warnings: string[];
  fieldWarnings: Map<string, string[]>;
}

interface FeedbackFieldCheck {
  fieldName: string;
  feedback: string;
}

/**
 * Extract quoted text from a feedback string.
 * Looks for text in single quotes (e.g., 'exact quote here')
 */
function extractQuotesFromFeedback(feedback: string): string[] {
  const quotes: string[] = [];
  // Match text between single quotes (5-80 chars, no newlines in the quote)
  const quotePattern = /'([^'\n]{5,80})'/g;
  let match;
  while ((match = quotePattern.exec(feedback)) !== null) {
    const quote = match[1].trim();
    // Skip if it looks like a time reference or placeholder
    if (!/^\[\d+:\d{2}/.test(quote) && !/^no (?:direct )?quote/i.test(quote)) {
      quotes.push(quote);
    }
  }
  return quotes;
}

/**
 * Count evidence bullet points in feedback.
 * Evidence bullets should be lines starting with - that contain quoted text or time ranges.
 */
function countEvidenceBullets(feedback: string): number {
  const lines = feedback.split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Evidence bullet: starts with - and contains either a quote (single quotes) or time pattern [m:ss]
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
      // Check if it looks like an evidence bullet (has quote or time reference)
      if (/'[^']+'/i.test(trimmed) || /\[\d+:\d{2}/i.test(trimmed) || /\[no timecode/i.test(trimmed)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Check if a quote appears (approximately) in the transcript.
 * Uses fuzzy matching: 70% of words must match in sequence.
 */
function quoteExistsInTranscript(quote: string, transcript: string): boolean {
  if (!quote || !transcript) return false;
  
  const normalizedQuote = quote.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
  const normalizedTranscript = transcript.toLowerCase().replace(/[^\w\s]/g, ' ');
  
  // Direct substring match
  if (normalizedTranscript.includes(normalizedQuote)) {
    return true;
  }
  
  // Fuzzy match: check if 70% of consecutive words appear in transcript
  const quoteWords = normalizedQuote.split(/\s+/).filter(Boolean);
  if (quoteWords.length < 3) return true; // Too short to validate meaningfully
  
  // Sliding window check
  const transcriptWords = normalizedTranscript.split(/\s+/).filter(Boolean);
  const windowSize = quoteWords.length;
  const matchThreshold = Math.floor(quoteWords.length * 0.7);
  
  for (let i = 0; i <= transcriptWords.length - windowSize; i++) {
    let matchCount = 0;
    for (let j = 0; j < windowSize; j++) {
      if (transcriptWords[i + j] === quoteWords[j]) {
        matchCount++;
      }
    }
    if (matchCount >= matchThreshold) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check for required feedback sections (all 4 must be present).
 */
function checkFeedbackSections(feedback: string): { hasAll: boolean; missing: string[] } {
  const requiredSections = [
    { name: 'Score Justification', patterns: [/\*\*Score Justification/i, /Score Justification:/i] },
    { name: 'Evidence from Speech', patterns: [/\*\*Evidence/i, /Evidence from Speech:/i, /Evidence:/i] },
    { name: 'What This Means', patterns: [/\*\*What This Means/i, /What This Means:/i, /Competitive Implication/i] },
    { name: 'How to Improve', patterns: [/\*\*How to Improve/i, /How to Improve:/i, /Improvement/i] },
  ];
  
  const missing: string[] = [];
  for (const section of requiredSections) {
    const found = section.patterns.some(p => p.test(feedback));
    if (!found) {
      missing.push(section.name);
    }
  }
  
  return { hasAll: missing.length === 0, missing };
}

/**
 * Validate a single feedback field for quality requirements.
 */
function validateFeedbackField(fieldName: string, feedback: string, transcript: string): string[] {
  const warnings: string[] = [];
  
  if (!feedback || feedback.trim().length < 50) {
    warnings.push(`${fieldName}: Feedback is too short (< 50 chars)`);
    return warnings;
  }
  
  // Check for required sections
  const sectionCheck = checkFeedbackSections(feedback);
  if (!sectionCheck.hasAll) {
    warnings.push(`${fieldName}: Missing sections: ${sectionCheck.missing.join(', ')}`);
  }
  
  // Count evidence bullets
  const bulletCount = countEvidenceBullets(feedback);
  if (bulletCount < 2) {
    warnings.push(`${fieldName}: Found ${bulletCount} evidence bullet(s), expected 2`);
  }
  
  // Verify quotes exist in transcript
  const quotes = extractQuotesFromFeedback(feedback);
  for (const quote of quotes) {
    if (!quoteExistsInTranscript(quote, transcript)) {
      // Only warn if the quote is substantial and not a placeholder
      if (quote.length > 15 && !/no (?:direct )?quote|not available|n\/a/i.test(quote)) {
        warnings.push(`${fieldName}: Quote not found in transcript: "${quote.substring(0, 30)}..."`);
      }
    }
  }
  
  // Check for character limit
  if (feedback.length > 900) {
    warnings.push(`${fieldName}: Feedback exceeds 900 char limit (${feedback.length} chars)`);
  }
  
  return warnings;
}

/**
 * Validate all feedback fields in an analysis object.
 * Returns validation result with per-field warnings.
 */
function validateAnalysisFeedback(analysis: any, transcript: string): FeedbackValidationResult {
  const warnings: string[] = [];
  const fieldWarnings = new Map<string, string[]>();
  
  if (!analysis || typeof analysis !== 'object') {
    return { isValid: false, warnings: ['Analysis object is missing or invalid'], fieldWarnings };
  }
  
  // Collect all feedback fields to validate
  const feedbackFields: FeedbackFieldCheck[] = [];
  
  // Content analysis fields
  if (analysis.contentAnalysis) {
    const ca = analysis.contentAnalysis;
    if (ca.topicAdherence?.feedback) feedbackFields.push({ fieldName: 'topicAdherence', feedback: ca.topicAdherence.feedback });
    if (ca.argumentStructure?.feedback) feedbackFields.push({ fieldName: 'argumentStructure', feedback: ca.argumentStructure.feedback });
    if (ca.depthOfAnalysis?.feedback) feedbackFields.push({ fieldName: 'depthOfAnalysis', feedback: ca.depthOfAnalysis.feedback });
    if (ca.examplesEvidence?.feedback) feedbackFields.push({ fieldName: 'examplesEvidence', feedback: ca.examplesEvidence.feedback });
    if (ca.timeManagement?.feedback) feedbackFields.push({ fieldName: 'timeManagement', feedback: ca.timeManagement.feedback });
  }
  
  // Delivery analysis fields
  if (analysis.deliveryAnalysis) {
    const da = analysis.deliveryAnalysis;
    if (da.vocalVariety?.feedback) feedbackFields.push({ fieldName: 'vocalVariety', feedback: da.vocalVariety.feedback });
    if (da.pacing?.feedback) feedbackFields.push({ fieldName: 'pacing', feedback: da.pacing.feedback });
    if (da.articulation?.feedback) feedbackFields.push({ fieldName: 'articulation', feedback: da.articulation.feedback });
    if (da.fillerWords?.feedback) feedbackFields.push({ fieldName: 'fillerWords', feedback: da.fillerWords.feedback });
  }
  
  // Language analysis fields
  if (analysis.languageAnalysis) {
    const la = analysis.languageAnalysis;
    if (la.vocabulary?.feedback) feedbackFields.push({ fieldName: 'vocabulary', feedback: la.vocabulary.feedback });
    if (la.rhetoricalDevices?.feedback) feedbackFields.push({ fieldName: 'rhetoricalDevices', feedback: la.rhetoricalDevices.feedback });
    if (la.emotionalAppeal?.feedback) feedbackFields.push({ fieldName: 'emotionalAppeal', feedback: la.emotionalAppeal.feedback });
    if (la.logicalAppeal?.feedback) feedbackFields.push({ fieldName: 'logicalAppeal', feedback: la.logicalAppeal.feedback });
  }
  
  // Body language analysis fields (only if assessable)
  if (analysis.bodyLanguageAssessable !== false && analysis.bodyLanguageAnalysis) {
    const bla = analysis.bodyLanguageAnalysis;
    if (bla.eyeContact?.feedback) feedbackFields.push({ fieldName: 'eyeContact', feedback: bla.eyeContact.feedback });
    if (bla.gestures?.feedback) feedbackFields.push({ fieldName: 'gestures', feedback: bla.gestures.feedback });
    if (bla.posture?.feedback) feedbackFields.push({ fieldName: 'posture', feedback: bla.posture.feedback });
    if (bla.stagePresence?.feedback) feedbackFields.push({ fieldName: 'stagePresence', feedback: bla.stagePresence.feedback });
  }
  
  // Validate each field
  let totalWarnings = 0;
  for (const field of feedbackFields) {
    const fieldProblems = validateFeedbackField(field.fieldName, field.feedback, transcript);
    if (fieldProblems.length > 0) {
      fieldWarnings.set(field.fieldName, fieldProblems);
      warnings.push(...fieldProblems);
      totalWarnings += fieldProblems.length;
    }
  }
  
  // Check for phrase reuse (10+ word phrases appearing in multiple fields)
  const phraseReuse = detectPhraseReuse(feedbackFields);
  if (phraseReuse.length > 0) {
    warnings.push(...phraseReuse);
  }
  
  // Validation passes if <30% of fields have major issues (missing sections or no evidence)
  const majorIssueThreshold = Math.floor(feedbackFields.length * 0.3);
  const majorIssues = Array.from(fieldWarnings.values()).filter(w => 
    w.some(msg => msg.includes('Missing sections') || msg.includes('evidence bullet'))
  ).length;
  
  return {
    isValid: majorIssues <= majorIssueThreshold,
    warnings,
    fieldWarnings,
  };
}

/**
 * Detect 10+ word phrases reused across different feedback fields.
 */
function detectPhraseReuse(fields: FeedbackFieldCheck[]): string[] {
  const warnings: string[] = [];
  const minPhraseLength = 10;
  
  // Extract all phrases of 10+ words from each field
  const fieldPhrases = new Map<string, Set<string>>();
  
  for (const field of fields) {
    const words = field.feedback.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    const phrases = new Set<string>();
    
    // Generate all 10-word consecutive sequences
    for (let i = 0; i <= words.length - minPhraseLength; i++) {
      const phrase = words.slice(i, i + minPhraseLength).join(' ');
      phrases.add(phrase);
    }
    
    fieldPhrases.set(field.fieldName, phrases);
  }
  
  // Check for reuse across fields
  const fieldNames = Array.from(fieldPhrases.keys());
  const reportedPhrases = new Set<string>();
  
  for (let i = 0; i < fieldNames.length; i++) {
    for (let j = i + 1; j < fieldNames.length; j++) {
      const phrasesA = fieldPhrases.get(fieldNames[i])!;
      const phrasesB = fieldPhrases.get(fieldNames[j])!;
      
      for (const phrase of phrasesA) {
        if (phrasesB.has(phrase) && !reportedPhrases.has(phrase)) {
          reportedPhrases.add(phrase);
          warnings.push(`Phrase reuse detected between ${fieldNames[i]} and ${fieldNames[j]}: "${phrase.substring(0, 40)}..."`);
          break; // Only report first reuse per field pair
        }
      }
    }
  }
  
  return warnings;
}

/**
 * Truncate feedback strings to max 900 chars while preserving structure.
 */
function truncateFeedbackInPlace(analysis: any, maxChars: number = 900): void {
  if (!analysis || typeof analysis !== 'object') return;
  
  const truncate = (obj: any, key: string) => {
    if (obj?.[key]?.feedback && typeof obj[key].feedback === 'string') {
      if (obj[key].feedback.length > maxChars) {
        // Try to truncate at a sentence boundary
        let truncated = obj[key].feedback.substring(0, maxChars);
        const lastPeriod = truncated.lastIndexOf('.');
        if (lastPeriod > maxChars * 0.7) {
          truncated = truncated.substring(0, lastPeriod + 1);
        } else {
          truncated = truncated.substring(0, maxChars - 3) + '...';
        }
        obj[key].feedback = truncated;
      }
    }
  };
  
  // Content
  if (analysis.contentAnalysis) {
    truncate(analysis.contentAnalysis, 'topicAdherence');
    truncate(analysis.contentAnalysis, 'argumentStructure');
    truncate(analysis.contentAnalysis, 'depthOfAnalysis');
    truncate(analysis.contentAnalysis, 'examplesEvidence');
    truncate(analysis.contentAnalysis, 'timeManagement');
  }
  
  // Delivery
  if (analysis.deliveryAnalysis) {
    truncate(analysis.deliveryAnalysis, 'vocalVariety');
    truncate(analysis.deliveryAnalysis, 'pacing');
    truncate(analysis.deliveryAnalysis, 'articulation');
    truncate(analysis.deliveryAnalysis, 'fillerWords');
  }
  
  // Language
  if (analysis.languageAnalysis) {
    truncate(analysis.languageAnalysis, 'vocabulary');
    truncate(analysis.languageAnalysis, 'rhetoricalDevices');
    truncate(analysis.languageAnalysis, 'emotionalAppeal');
    truncate(analysis.languageAnalysis, 'logicalAppeal');
  }
  
  // Body Language
  if (analysis.bodyLanguageAnalysis) {
    truncate(analysis.bodyLanguageAnalysis, 'eyeContact');
    truncate(analysis.bodyLanguageAnalysis, 'gestures');
    truncate(analysis.bodyLanguageAnalysis, 'posture');
    truncate(analysis.bodyLanguageAnalysis, 'stagePresence');
  }
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
  // Use audio-capable models only. 
  // NOTE: google/gemini-3-flash-preview does NOT reliably support audio transcription via OpenRouter.
  // We default to gemini-2.0-flash-001 which has proven audio support.
  // DO NOT include openai/whisper-large-v3 - it's not a valid chat completion model on OpenRouter.
  
  // Default transcription model that's known to work with audio
  const defaultTranscribeModel = 'google/gemini-2.0-flash-001';
  
  const candidates = [
    primary,
    process.env.TRANSCRIBE_MODEL_FALLBACK,
    // Use a known working model for transcription (NOT the preview model)
    defaultTranscribeModel,
    // Only fall back to judge model if it's not a preview model
    judgeModel.includes('preview') ? null : judgeModel,
  ].filter((x): x is string => Boolean(x && String(x).trim()));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return candidates.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

// ===========================================
// LLM SAMPLING CONFIG (reduce stylistic collapse + determinism)
// ===========================================

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const TRANSCRIBE_SAMPLING = {
  // Deterministic transcription.
  temperature: numEnv('TRANSCRIBE_TEMPERATURE', 0),
  top_p: numEnv('TRANSCRIBE_TOP_P', 1),
  presence_penalty: 0,
  frequency_penalty: 0,
};

const JUDGE_SAMPLING = {
  // High enough to vary phrasing/structure, low enough to stay JSON-safe under strict schema.
  temperature: numEnv('JUDGE_TEMPERATURE', 0.55),
  top_p: numEnv('JUDGE_TOP_P', 0.92),
  // Mild repetition discouragement (supported by OpenAI-style APIs; ignored if provider doesn’t implement).
  presence_penalty: numEnv('JUDGE_PRESENCE_PENALTY', 0.35),
  frequency_penalty: numEnv('JUDGE_FREQUENCY_PENALTY', 0.2),
};

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

/**
 * Result type for callOpenRouterJson with parse metrics
 */
interface OpenRouterJsonResult {
  data: any;
  parseMetrics: ParseMetrics;
}

/**
 * Custom error for JSON parse failures - contains raw output for debugging
 */
class JsonParseError extends Error {
  rawOutput: string;
  parseFailCount: number;
  repairAttempted: boolean;
  
  constructor(message: string, rawOutput: string, parseFailCount: number, repairAttempted: boolean) {
    super(message);
    this.name = 'JsonParseError';
    this.rawOutput = rawOutput;
    this.parseFailCount = parseFailCount;
    this.repairAttempted = repairAttempted;
  }
}

async function callOpenRouterJson(params: {
  apiKey: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>;
  maxTokens: number;
  sampling?: {
    temperature?: number;
    top_p?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
  };
  /**
   * Optional minimal schema hint used ONLY if JSON parsing fails.
   * This is used to perform a deterministic "format-only" repair pass.
   */
  schemaForRepair?: string;
}): Promise<OpenRouterJsonResult> {
  const { apiKey, model, messages, maxTokens, sampling, schemaForRepair } = params;

  const temperature = typeof sampling?.temperature === 'number' ? sampling.temperature : 0.1;
  const top_p = typeof sampling?.top_p === 'number' ? sampling.top_p : undefined;
  const presence_penalty = typeof sampling?.presence_penalty === 'number' ? sampling.presence_penalty : undefined;
  const frequency_penalty = typeof sampling?.frequency_penalty === 'number' ? sampling.frequency_penalty : undefined;

  const parseMetrics: ParseMetrics = {
    parseFailCount: 0,
    repairUsed: false,
  };

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
      messages,
      response_format: { type: 'json_object' },
      temperature,
      ...(typeof top_p === 'number' ? { top_p } : {}),
      ...(typeof presence_penalty === 'number' ? { presence_penalty } : {}),
      ...(typeof frequency_penalty === 'number' ? { frequency_penalty } : {}),
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
  if (parsed) {
    return { data: parsed, parseMetrics };
  }

  // First parse attempt failed
  parseMetrics.parseFailCount = 1;
  parseMetrics.rawOutput = raw;
  console.warn(`⚠️ JSON parse failed (attempt 1). Raw output length: ${raw.length}`);

  // Deterministic "format-only" repair pass.
  // IMPORTANT: This must NOT re-run the original task with stronger constraints, otherwise it amplifies sameness.
  if (schemaForRepair) {
    parseMetrics.repairUsed = true;
    console.log('   🔧 Attempting JSON repair pass...');
    
    const repairController = new AbortController();
    // Repair should be fast; it's only for JSON formatting correction.
    const repairTimeout = setTimeout(() => repairController.abort(), 90000);
    
    try {
      const repairResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
            {
              role: 'system',
              content:
                'You are a JSON repair utility. Fix formatting ONLY. ' +
                'Do not change meanings, scores, quotes, or time ranges. ' +
                'Output MUST be a single valid JSON object and nothing else.',
            },
            {
              role: 'user',
              content:
                `Target JSON shape (keys must match; no extra keys):\n${schemaForRepair}\n\n` +
                `Invalid model output to repair:\n${raw}`,
            },
          ],
          response_format: { type: 'json_object' },
          // Make repair deterministic and non-stylistic.
          temperature: 0,
          top_p: 1,
          max_tokens: maxTokens,
        }),
        signal: repairController.signal,
      });
      clearTimeout(repairTimeout);
      
      if (repairResp.ok) {
        const repairData = await repairResp.json();
        const repairText = repairData.choices?.[0]?.message?.content;
        if (typeof repairText === 'string' && repairText.trim()) {
          const parsedRepair = tryParse(repairText);
          if (parsedRepair) {
            console.log('   ✅ JSON repair successful');
            return { data: parsedRepair, parseMetrics };
          }
        }
      }
      
      // Repair failed - increment fail count
      parseMetrics.parseFailCount = 2;
      console.warn('   ❌ JSON repair failed');
    } catch (repairError) {
      clearTimeout(repairTimeout);
      parseMetrics.parseFailCount = 2;
      const repairMsg = repairError instanceof Error ? repairError.message : String(repairError);
      console.warn(`   ❌ JSON repair error: ${repairMsg}`);
    }
  }

  // DO NOT return default scores or cached analysis - throw error with raw output
  const snippet = raw.slice(0, 500);
  throw new JsonParseError(
    `Model returned non-JSON content. First 500 chars: ${snippet}`,
    raw,
    parseMetrics.parseFailCount,
    parseMetrics.repairUsed
  );
}

function buildInsufficientSpeechAnalysis(durationSeconds: number, reason: string): NonNullable<GeminiAnalysisResult['analysis']> {
  const duration = formatDurationSeconds(durationSeconds);
  const warning = `⚠️ INSUFFICIENT SPEECH DATA: ${reason}`;
  const feedback = `**Score Justification:** ${warning}\n\n**Evidence from Speech:**\n- Transcript is empty or too short to evaluate.\n\n**What This Means:** We cannot fairly score competitive impromptu categories without audible speech and a usable transcript.\n\n**How to Improve:**\n1. Re-record ensuring microphone permissions are enabled and audio is captured clearly.\n2. Speak continuously for competitive length (4–6 minutes optimal) instead of extended silence.\n3. Test a 10-second recording and confirm playback has clear audio before starting a full round.`;

  return {
    classification: 'too_short',
    capsApplied: true,
    bodyLanguageAssessable: true, // Default to true for insufficient speech (not a framing issue)
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
// CHAMPIONSHIP-V1 PROMPT BUILDER
// ===========================================

function buildChampionshipJudgePrompt(
  theme: string,
  quote: string,
  transcriptTimecoded: string,
  durationSec: number,
  durationText: string,
  wordCount: number,
  wpm: number,
  fillerCount: number,
  fillerPerMin: number,
  pausesPerMin: number | null
): string {
  return `You are WinBallot Championship Judge (NSDA-caliber). Your job is to produce a ballot that makes elite competitors feel in control: exact reasons, receipts, and clear upgrade levers.

OUTPUT RULES (NON-NEGOTIABLE)
- Return ONLY one valid JSON object. No markdown. No code fences. No commentary.
- Do NOT invent quotes. Every quote MUST be a verbatim substring of the transcript provided.
- Do NOT invent timestamps. If timecodes are missing/uncertain, use "[no timecode available]".
- Do NOT claim tone/body language observations unless supported by explicit provided metrics. (In this version, tone/body language are NOT scored.)
- Be specific. Avoid generic advice. Every major claim must be supported by receipts (quotes/metrics).

INPUTS YOU WILL RECEIVE
THEME: ${theme}
QUOTE: ${quote}
ROUND_TYPE: impromptu

TRANSCRIPT (time-coded if available; only source for quotes):
"""
${transcriptTimecoded}
"""

TRUSTED METRICS (computed by system; do not change):
durationSec: ${durationSec}
durationText: ${durationText}
wordCount: ${wordCount}
wpm: ${wpm}
fillerWordCount: ${fillerCount}
fillerPerMin: ${fillerPerMin}
${pausesPerMin !== null ? `pausesPerMin: ${pausesPerMin}` : '(pausesPerMin: not available)'}

STEP 0 — CLASSIFY THE SPEECH (MANDATORY FIRST STEP)
Choose exactly one classification.label:
- normal: coherent, on-theme, has structure
- too_short: durationSec < 60 OR wordCount < 100
- nonsense: incoherent, word salad, gibberish
- off_topic: coherent but unrelated to theme/quote
- mostly_off_topic: minimal connection; majority unrelated content

CAPS (HARD):
- too_short / nonsense / off_topic => capsApplied=true, maxOverallScore=2.5
- mostly_off_topic => capsApplied=true, maxOverallScore=6.0
- normal => capsApplied=false, maxOverallScore=null

If capped:
- Keep output shorter: evidence 5–10, levers 1–2, microRewrites 0–1, RFD 6–10 sentences.
- Still be specific: explain exactly what caused the cap and what to do next.

SCORING POLICY (CREDIBLE TODAY)
Overall score is based ONLY on 3 categories:
- argumentStructure (weight 0.45)
- depthWeighing (weight 0.35)
- rhetoricLanguage (weight 0.20)

NOT SCORED (exclude from overall):
- body language
- vocal tone (emotion/prosody)
- subjective delivery (confidence/charisma)

Delivery is METRICS-ONLY and reported separately:
- wpm, fillerPerMin, duration, wordCount (and pausesPerMin if provided)
Do not generate a numeric "delivery score" from vibes.

EVIDENCE RULES (RECEIPTS SYSTEM)
Create evidence items first, then write everything else using evidenceIds.
Evidence types:
1) QUOTE evidence:
- quote: 5–20 words, verbatim substring from transcript
- timeRange: "m:ss-m:ss" OR "[no timecode available]"
- label: STRENGTH or GAP
- warrant: 1–3 sentences explaining what this proves and why it matters competitively

2) METRIC evidence:
- metric: {name, value, unit}
- label: STRENGTH or GAP
- warrant: 1–3 sentences describing judge impact

COUNTS:
- normal: 12–20 evidence items
- capped: 5–10 evidence items

RFD REQUIREMENTS (HIGH DETAIL)
rfd.summary:
- normal: 10–16 sentences, judge-style, specific, not fluffy
- capped: 6–10 sentences
Must include:
- what earned the score
- what capped the score
- what changes move you to next band
End with one sentence: "This did not reach [next band] because [missing move]."

rfd.whyThisScore:
- Exactly 2 claims
- Each claim must cite 3–5 evidenceIds

rfd.whyNotHigher:
- nextBand string like "8.6+"
- Exactly 2 blockers
- Each blocker cites 2–5 evidenceIds

LEVERS (RANKED FIXES)
- normal: output 3–5 levers ranked by estimatedScoreGain
- capped: output 1–2 levers only
Each lever MUST include:
- rank: number (1 = highest priority)
- name
- estimatedScoreGain (e.g., "+0.4 to +0.8")
- patternName (e.g., "Warrant Gap", "No Tradeoff", "Weak Synthesis", "Mechanism Missing", "Link-back Drift")
- diagnosis: 6–12 sentences, deep reasoning (why it happens in THIS speech)
- judgeImpact: 3–6 sentences (how outround judges evaluate this)
- evidenceIds: 3–6 ids
- fixRule: one sentence rule
- coachQuestions: 3–5 hard questions (tradeoff/mechanism/so-what/counterexample)
- sayThisInstead: exactly 2 copyable lines
- counterexampleKit: counterexampleLine + resolutionLine
- drill: name + exactly 3 steps + measurable goal containing a number/%/≥ and "by next session"

MICRO-REWRITES
- normal: 2–4 microRewrites
- capped: 0–1
Each microRewrite must include:
- before: {quote, timeRange} using a real transcript quote
- after: 1–2 improved sentences
- whyStronger: 1–3 sentences explaining judge impact
- evidenceIds: 1–3 ids

DELIVERY METRICS COACHING (NOT SCORED)
Include a metrics snapshot and 1 drill:
- wpm, fillerPerMin, durationText, wordCount, (pausesPerMin if provided)
Give one drill and a measurable goal (reduce fillerPerMin by X, add pauses, etc.).

NEXT-ROUND CHECKLIST (TIGHT)
actionPlan.nextRoundChecklist must contain exactly 3 steps.
Each step must include instruction + measurable successCriteria.

Also include:
- warmup5Min: exactly 3 bullets
- duringSpeechCues: exactly 2 bullets
- postRoundReview: exactly 3 bullets

OUTPUT JSON SCHEMA (MUST MATCH EXACTLY)
Return one JSON object with these keys:

{
  "version": "championship-v1",
  "meta": {
    "roundType": "impromptu",
    "theme": "",
    "quote": "",
    "model": "",
    "generatedAt": ""
  },
  "classification": {
    "label": "",
    "capsApplied": false,
    "maxOverallScore": null,
    "reasons": []
  },
  "speechRecord": {
    "transcript": "",
    "timecodeNote": ""
  },
  "speechStats": {
    "durationSec": 0,
    "durationText": "",
    "wordCount": 0,
    "wpm": 0,
    "fillerWordCount": 0,
    "fillerPerMin": 0.0,
    "pausesPerMin": null
  },
  "scoring": {
    "weights": { "argumentStructure": 0.45, "depthWeighing": 0.35, "rhetoricLanguage": 0.20 },
    "categoryScores": {
      "argumentStructure": { "score": 0.0, "weighted": 0.0 },
      "depthWeighing": { "score": 0.0, "weighted": 0.0 },
      "rhetoricLanguage": { "score": 0.0, "weighted": 0.0 }
    },
    "overallScore": 0.0,
    "performanceTier": "",
    "tournamentReady": false
  },
  "rfd": {
    "summary": "",
    "whyThisScore": [
      { "claim": "", "evidenceIds": [] },
      { "claim": "", "evidenceIds": [] }
    ],
    "whyNotHigher": {
      "nextBand": "",
      "blockers": [
        { "blocker": "", "evidenceIds": [] },
        { "blocker": "", "evidenceIds": [] }
      ]
    }
  },
  "evidence": [],
  "levers": [],
  "microRewrites": [],
  "deliveryMetricsCoaching": {
    "snapshot": {
      "wpm": 0,
      "fillerPerMin": 0.0,
      "durationText": "",
      "wordCount": 0,
      "pausesPerMin": null
    },
    "drill": { "name": "", "steps": ["", "", ""], "goal": "" }
  },
  "actionPlan": {
    "nextRoundChecklist": [
      { "step": 1, "instruction": "", "successCriteria": "" },
      { "step": 2, "instruction": "", "successCriteria": "" },
      { "step": 3, "instruction": "", "successCriteria": "" }
    ],
    "warmup5Min": ["", "", ""],
    "duringSpeechCues": ["", ""],
    "postRoundReview": ["", "", ""]
  },
  "warnings": []
}

SCORING CONSTRAINTS
- Scores must be realistic 0.0–10.0 with one decimal.
- categoryScores.*.weighted = score * weight, and overallScore = sum(weighted).
- If capped: overallScore must be <= maxOverallScore and subscores should reflect the cap (don't output 8+ subscores).
- performanceTier should match score bands:
  9.0–10.0 Finals-caliber
  8.0–8.9 Breaking rounds
  7.0–7.9 Competitive
  5.0–6.9 Developing
  3.0–4.9 Major issues
  0.0–2.9 Off-topic/nonsense/too short
- tournamentReady=true ONLY if overallScore >= 7.8 AND no major blockers AND fillerPerMin < 6.0 AND durationSec >= 210.

RETURN ONLY THE JSON OBJECT.`;
}

// Championship schema for repair pass
const CHAMPIONSHIP_SCHEMA_FOR_REPAIR = `{
  "version": "championship-v1",
  "meta": { "roundType": <string>, "theme": <string>, "quote": <string>, "model": <string>, "generatedAt": <string> },
  "classification": { "label": <"normal"|"too_short"|"nonsense"|"off_topic"|"mostly_off_topic">, "capsApplied": <boolean>, "maxOverallScore": <number|null>, "reasons": [<string>] },
  "speechRecord": { "transcript": <string>, "timecodeNote": <string> },
  "speechStats": { "durationSec": <number>, "durationText": <string>, "wordCount": <number>, "wpm": <number>, "fillerWordCount": <number>, "fillerPerMin": <number>, "pausesPerMin": <number|null> },
  "scoring": {
    "weights": { "argumentStructure": 0.45, "depthWeighing": 0.35, "rhetoricLanguage": 0.20 },
    "categoryScores": {
      "argumentStructure": { "score": <number>, "weighted": <number> },
      "depthWeighing": { "score": <number>, "weighted": <number> },
      "rhetoricLanguage": { "score": <number>, "weighted": <number> }
    },
    "overallScore": <number>,
    "performanceTier": <string>,
    "tournamentReady": <boolean>
  },
  "rfd": {
    "summary": <string>,
    "whyThisScore": [{ "claim": <string>, "evidenceIds": [<string>] }],
    "whyNotHigher": { "nextBand": <string>, "blockers": [{ "blocker": <string>, "evidenceIds": [<string>] }] }
  },
  "evidence": [{ "id": <string>, "type": <"QUOTE"|"METRIC">, "label": <"STRENGTH"|"GAP">, "quote": <string|undefined>, "timeRange": <string|undefined>, "metric": <object|undefined>, "warrant": <string> }],
  "levers": [{ "rank": <number>, "name": <string>, "estimatedScoreGain": <string>, "patternName": <string>, "diagnosis": <string>, "judgeImpact": <string>, "evidenceIds": [<string>], "fixRule": <string>, "coachQuestions": [<string>], "sayThisInstead": [<string>, <string>], "counterexampleKit": { "counterexampleLine": <string>, "resolutionLine": <string> }, "drill": { "name": <string>, "steps": [<string>, <string>, <string>], "goal": <string> } }],
  "microRewrites": [{ "before": { "quote": <string>, "timeRange": <string> }, "after": <string>, "whyStronger": <string>, "evidenceIds": [<string>] }],
  "deliveryMetricsCoaching": { "snapshot": { "wpm": <number>, "fillerPerMin": <number>, "durationText": <string>, "wordCount": <number>, "pausesPerMin": <number|null> }, "drill": { "name": <string>, "steps": [<string>, <string>, <string>], "goal": <string> } },
  "actionPlan": {
    "nextRoundChecklist": [{ "step": <number>, "instruction": <string>, "successCriteria": <string> }],
    "warmup5Min": [<string>, <string>, <string>],
    "duringSpeechCues": [<string>, <string>],
    "postRoundReview": [<string>, <string>, <string>]
  },
  "warnings": [<string>]
}`;

// ===========================================
// CHAMPIONSHIP ANALYSIS HELPERS
// ===========================================

/**
 * Compute performance tier from overall score (championship format)
 */
function computeChampionshipTier(overallScore: number): string {
  if (overallScore >= 9.0) return 'Finals-caliber';
  if (overallScore >= 8.0) return 'Breaking rounds';
  if (overallScore >= 7.0) return 'Competitive';
  if (overallScore >= 5.0) return 'Developing';
  if (overallScore >= 3.0) return 'Major issues';
  return 'Off-topic/nonsense/too short';
}

/**
 * Enforce classification caps on championship analysis
 */
function enforceChampionshipCapsInPlace(analysis: ChampionshipAnalysis): void {
  const label = analysis.classification?.label;
  let maxScore = 10.0;
  let capsApplied = false;

  switch (label) {
    case 'too_short':
    case 'nonsense':
    case 'off_topic':
      maxScore = 2.5;
      capsApplied = true;
      break;
    case 'mostly_off_topic':
      maxScore = 6.0;
      capsApplied = true;
      break;
    default:
      maxScore = 10.0;
      capsApplied = false;
  }

  analysis.classification.capsApplied = capsApplied;
  analysis.classification.maxOverallScore = capsApplied ? maxScore : null;

  // Cap the scores if needed
  if (capsApplied && analysis.scoring) {
    const capScore = (score: number) => Math.min(score, maxScore + 0.5); // Allow subscore slightly above cap
    
    if (analysis.scoring.categoryScores.argumentStructure) {
      analysis.scoring.categoryScores.argumentStructure.score = capScore(analysis.scoring.categoryScores.argumentStructure.score);
    }
    if (analysis.scoring.categoryScores.depthWeighing) {
      analysis.scoring.categoryScores.depthWeighing.score = capScore(analysis.scoring.categoryScores.depthWeighing.score);
    }
    if (analysis.scoring.categoryScores.rhetoricLanguage) {
      analysis.scoring.categoryScores.rhetoricLanguage.score = capScore(analysis.scoring.categoryScores.rhetoricLanguage.score);
    }
    
    // Cap overall score
    analysis.scoring.overallScore = Math.min(analysis.scoring.overallScore, maxScore);
  }
}

/**
 * Recompute championship weighted scores and overall score
 */
function recomputeChampionshipScoresInPlace(analysis: ChampionshipAnalysis): void {
  if (!analysis.scoring) return;

  const weights = { argumentStructure: 0.45, depthWeighing: 0.35, rhetoricLanguage: 0.20 };
  analysis.scoring.weights = weights;

  const cs = analysis.scoring.categoryScores;
  
  // Recompute weighted scores
  if (cs.argumentStructure) {
    cs.argumentStructure.weighted = round1(cs.argumentStructure.score * weights.argumentStructure);
  }
  if (cs.depthWeighing) {
    cs.depthWeighing.weighted = round1(cs.depthWeighing.score * weights.depthWeighing);
  }
  if (cs.rhetoricLanguage) {
    cs.rhetoricLanguage.weighted = round1(cs.rhetoricLanguage.score * weights.rhetoricLanguage);
  }

  // Recompute overall
  const overall = (cs.argumentStructure?.weighted || 0) +
                  (cs.depthWeighing?.weighted || 0) +
                  (cs.rhetoricLanguage?.weighted || 0);
  
  analysis.scoring.overallScore = clamp(round1(overall), 0, 10);
  analysis.scoring.performanceTier = computeChampionshipTier(analysis.scoring.overallScore);
}

/**
 * Enforce tournament readiness for championship format
 */
function enforceChampionshipTournamentReadiness(
  analysis: ChampionshipAnalysis,
  fillerPerMin: number,
  durationSec: number
): void {
  if (!analysis.scoring) return;

  const overallScore = analysis.scoring.overallScore;
  const hasNoMajorBlockers = !analysis.classification.capsApplied;
  
  // tournamentReady=true ONLY if:
  // - overallScore >= 7.8
  // - no caps applied
  // - fillerPerMin < 6.0
  // - durationSec >= 210 (3.5 minutes)
  analysis.scoring.tournamentReady = 
    overallScore >= 7.8 &&
    hasNoMajorBlockers &&
    fillerPerMin < 6.0 &&
    durationSec >= 210;
}

/**
 * Build a minimal championship analysis for capped/insufficient speeches
 */
function buildInsufficientChampionshipAnalysis(
  theme: string,
  quote: string,
  transcript: string,
  durationSec: number,
  wordCount: number,
  wpm: number,
  fillerCount: number,
  fillerPerMin: number,
  classification: 'too_short' | 'nonsense' | 'off_topic',
  reason: string,
  modelName: string
): ChampionshipAnalysis {
  const durationText = formatDurationSeconds(durationSec);
  
  return {
    version: 'championship-v1',
    meta: {
      roundType: 'impromptu',
      theme,
      quote,
      model: modelName,
      generatedAt: new Date().toISOString(),
    },
    classification: {
      label: classification,
      capsApplied: true,
      maxOverallScore: 2.5,
      reasons: [reason],
    },
    speechRecord: {
      transcript,
      timecodeNote: 'Timecodes estimated or unavailable',
    },
    speechStats: {
      durationSec,
      durationText,
      wordCount,
      wpm,
      fillerWordCount: fillerCount,
      fillerPerMin,
      pausesPerMin: null,
    },
    scoring: {
      weights: { argumentStructure: 0.45, depthWeighing: 0.35, rhetoricLanguage: 0.20 },
      categoryScores: {
        argumentStructure: { score: 1.0, weighted: 0.45 },
        depthWeighing: { score: 1.0, weighted: 0.35 },
        rhetoricLanguage: { score: 1.0, weighted: 0.20 },
      },
      overallScore: 1.0,
      performanceTier: 'Off-topic/nonsense/too short',
      tournamentReady: false,
    },
    rfd: {
      summary: `This speech is classified as "${classification}" and cannot be scored normally. ${reason} To exit this cap, ensure your speech: (1) runs at least 60 seconds with 100+ words, (2) directly addresses the provided quote/theme, and (3) follows a coherent structure. Focus on building a clear thesis that interprets the quote, supporting it with 2-3 developed examples, and concluding with a synthesis.`,
      whyThisScore: [
        { claim: `The speech did not meet minimum requirements: ${reason}`, evidenceIds: ['E1'] },
        { claim: 'Without sufficient content addressing the topic, competitive scoring cannot apply.', evidenceIds: ['E1'] },
      ],
      whyNotHigher: {
        nextBand: '5.0+',
        blockers: [
          { blocker: `Classification "${classification}" triggers hard cap at 2.5`, evidenceIds: ['E1'] },
          { blocker: 'Must meet basic requirements before content can be evaluated', evidenceIds: ['E1'] },
        ],
      },
    },
    evidence: [
      {
        id: 'E1',
        type: 'METRIC',
        label: 'GAP',
        metric: { name: 'classification', value: 0, unit: classification },
        warrant: reason,
      },
    ],
    levers: [
      {
        rank: 1,
        name: 'Exit the cap',
        estimatedScoreGain: '+3.0 to +5.0',
        patternName: 'Fundamental Gap',
        diagnosis: `The speech is classified as "${classification}" which applies a hard score cap. ${reason} This prevents any meaningful competitive evaluation. The first priority is meeting basic requirements: speak for at least 60 seconds with 100+ words, directly address the quote/theme, and maintain coherent structure throughout.`,
        judgeImpact: 'Judges cannot award competitive scores to speeches that do not meet fundamental requirements. A too-short, off-topic, or nonsensical speech will always rank at the bottom regardless of any strong moments.',
        evidenceIds: ['E1'],
        fixRule: 'Before anything else: hit 60+ seconds, 100+ words, and directly interpret the quote.',
        coachQuestions: [
          'What is the quote literally saying?',
          'What universal truth or insight does it suggest?',
          'What 2-3 examples from real life illustrate this truth?',
          'How will you connect each example back to the quote?',
        ],
        sayThisInstead: [
          'This quote suggests that [interpretation]. We see this truth in [example 1], [example 2], and [example 3].',
          'Ultimately, [quote meaning] because [synthesis of examples]. This matters because [broader significance].',
        ],
        counterexampleKit: {
          counterexampleLine: 'Some might say this quote does not apply when...',
          resolutionLine: 'However, even in those cases, [explain why the interpretation still holds].',
        },
        drill: {
          name: 'Minimum Viable Speech',
          steps: [
            'Set a 90-second timer and speak continuously about ANY quote interpretation',
            'Record and count words - must exceed 100',
            'Check: Did you mention the quote at least 3 times and give 2+ examples?',
          ],
          goal: 'Deliver 3 consecutive practice speeches that each hit 90+ seconds, 120+ words, and reference the quote 3+ times by next session.',
        },
      },
    ],
    microRewrites: [],
    deliveryMetricsCoaching: {
      snapshot: {
        wpm,
        fillerPerMin,
        durationText,
        wordCount,
        pausesPerMin: null,
      },
      drill: {
        name: 'Continuous Speech Practice',
        steps: [
          'Pick any quote and set a 90-second timer',
          'Speak without stopping - do not restart or pause to think',
          'Review: note where you struggled and plan content for those moments',
        ],
        goal: 'Complete 5 uninterrupted 90-second speeches by next session.',
      },
    },
    actionPlan: {
      nextRoundChecklist: [
        { step: 1, instruction: 'Speak for minimum 90 seconds', successCriteria: 'Timer shows 1:30+ when you stop' },
        { step: 2, instruction: 'Reference the quote 3+ times', successCriteria: 'Count 3 distinct quote mentions in transcript' },
        { step: 3, instruction: 'Give 2+ developed examples', successCriteria: 'Each example has claim + evidence + link-back' },
      ],
      warmup5Min: [
        'Read the quote aloud 3 times, emphasizing different words each time',
        'State your interpretation in one sentence',
        'List 3 examples that could support it',
      ],
      duringSpeechCues: [
        'After each example, say "This connects to the quote because..."',
        'If stuck, return to restating the quote and your thesis',
      ],
      postRoundReview: [
        'Did you hit 90+ seconds? If not, where did you stop early?',
        'Count quote references - target 3+',
        'Check each example for clear link-back to theme',
      ],
    },
    warnings: [`Speech classified as "${classification}": ${reason}`],
  };
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

    // ----------------------------
    // TASK D: Video processing with ffmpeg fallback
    // ----------------------------
    // Reliability: large videos often exceed gateway limits when Base64-encoded.
    // If file is large, transcode to a smaller MP4 before encoding.
    const originalSizeMb = await statSizeMB(input.videoPath);
    let videoPathForAnalysis = input.videoPath;
    let analysisWarning: string | undefined;
    let useVideoForAnalysis = true; // Track if we can use video at all
    
    const VIDEO_SIZE_LIMIT_MB = 20; // Max size to attempt video analysis without compression
    
    if (originalSizeMb > 12) {
      console.warn(`⚠️ Large video (${originalSizeMb.toFixed(2)}MB) detected. Creating compressed analysis copy...`);
      try {
        videoPathForAnalysis = await transcodeVideoForAnalysis(input.videoPath);
        const compressedSizeMb = await statSizeMB(videoPathForAnalysis);
        console.log(`   ✅ Compressed video ready: ${compressedSizeMb.toFixed(2)}MB (${path.basename(videoPathForAnalysis)})`);
      } catch (transcodeError) {
        const transcodeMsg = transcodeError instanceof Error ? transcodeError.message : String(transcodeError);
        console.error(`❌ ffmpeg transcode failed: ${transcodeMsg}`);
        
        // TASK D Fallback: try original video if size <= limit
        if (originalSizeMb <= VIDEO_SIZE_LIMIT_MB) {
          console.log(`   🔄 Fallback: Using original video (${originalSizeMb.toFixed(2)}MB <= ${VIDEO_SIZE_LIMIT_MB}MB limit)`);
          videoPathForAnalysis = input.videoPath;
          analysisWarning = `Video compression failed; using original video. Analysis may be less detailed.`;
        } else {
          // Original too large - fall back to audio-only analysis
          console.log(`   🔄 Fallback: Original video too large (${originalSizeMb.toFixed(2)}MB > ${VIDEO_SIZE_LIMIT_MB}MB). Will use audio-only analysis.`);
          videoPathForAnalysis = input.videoPath; // Keep for audio extraction
          useVideoForAnalysis = false;
          analysisWarning = `Video compression failed and original too large. Using audio-only analysis; body language scores are estimates.`;
        }
      }
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
        const result = await callOpenRouterJson({
          apiKey,
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: transcribePrompt },
                { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
              ],
            },
          ],
          maxTokens: 4000, // Increased from 2500 to handle longer speeches
          sampling: TRANSCRIBE_SAMPLING,
          schemaForRepair: `{"transcript":"<full transcribed text>"}`,
        });
        return typeof result.data?.transcript === 'string' ? result.data.transcript : '';
      } catch (e) {
        // Fallback: some providers expect audio_url data URL
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`⚠️ input_audio transcription failed for model=${model} (${msg}). Retrying with audio_url...`);
        const result = await callOpenRouterJson({
          apiKey,
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: transcribePrompt },
                { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${b64}` } },
              ],
            },
          ],
          maxTokens: 4000, // Increased from 2500 to handle longer speeches
          sampling: TRANSCRIBE_SAMPLING,
          schemaForRepair: `{"transcript":"<full transcribed text>"}`,
        });
        return typeof result.data?.transcript === 'string' ? result.data.transcript : '';
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

    // ----------------------------
    // TASK A: Compute transcript integrity metadata
    // ----------------------------
    const transcriptIntegrity = computeTranscriptIntegrity(transcript);
    console.log(`   🔐 Transcript integrity: wordCount=${transcriptIntegrity.wordCount}, charLen=${transcriptIntegrity.charLen}, sha256=${transcriptIntegrity.sha256.slice(0, 16)}...`);
    if (transcriptIntegrity.isSuspicious) {
      console.warn(`   ⚠️ SUSPICIOUS TRANSCRIPT: ${transcriptIntegrity.suspiciousReason}`);
    }

    // ----------------------------
    // TASK B: Deterministic heuristic pre-check BEFORE judge LLM
    // ----------------------------
    const heuristicResult = classifyTranscriptHeuristic(transcript, input.theme, input.quote);
    console.log(`   🔍 Heuristic classification: ${heuristicResult.classification} (skipLLM=${heuristicResult.skipLLM}, maxScore=${heuristicResult.maxOverallScore})`);
    if (heuristicResult.reason !== 'Transcript passes heuristic checks') {
      console.log(`      Reason: ${heuristicResult.reason}`);
    }

    // If heuristic says skip LLM, return guarded analysis immediately
    if (heuristicResult.skipLLM) {
      const durationSecondsActual =
        durationSeconds && durationSeconds > 0 ? durationSeconds : (input.durationSecondsHint || 0);
      const analysis = buildInsufficientSpeechAnalysis(durationSecondsActual, heuristicResult.reason);
      analysis.classification = heuristicResult.classification;
      analysis.capsApplied = true;
      analysis.overallScore = Math.min(analysis.overallScore, heuristicResult.maxOverallScore);
      
      console.warn(`⚠️ Heuristic pre-check failed. Returning guarded analysis. Classification: ${heuristicResult.classification}`);
      return {
        success: true,
        transcript,
        analysis,
        transcriptIntegrity,
      };
    }

    // Legacy check for backward compatibility (transcript too short)
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
        transcriptIntegrity,
      };
    }

    // ----------------------------
    // Step 2) Judge using transcript (+ optional video)
    // ----------------------------
    // Video payloads can massively increase latency/cost for longer recordings.
    // Default: include video only up to MAX_VIDEO_SECONDS_FOR_ANALYSIS (180s) unless explicitly disabled.
    // Also skip video if useVideoForAnalysis=false (TASK D fallback)
    const maxVideoSeconds = Number(process.env.MAX_VIDEO_SECONDS_FOR_ANALYSIS || 180);
    const includeVideo =
      useVideoForAnalysis &&  // TASK D: respect ffmpeg fallback flag
      process.env.INCLUDE_VIDEO_IN_ANALYSIS !== 'false' &&
      durationSeconds > 0 &&
      Number.isFinite(maxVideoSeconds) &&
      maxVideoSeconds > 0 &&
      durationSeconds <= maxVideoSeconds;
    const base64Video = includeVideo ? await encodeVideoToBase64(videoPathForAnalysis) : null;
    if (base64Video) {
      console.log(`   📹 Video encoded (Base64 length: ${base64Video.length})`);
    } else {
      const reason = !useVideoForAnalysis 
        ? 'ffmpeg fallback (audio-only)'
        : process.env.INCLUDE_VIDEO_IN_ANALYSIS === 'false' 
          ? 'INCLUDE_VIDEO_IN_ANALYSIS=false' 
          : `duration>${Number.isFinite(maxVideoSeconds) ? maxVideoSeconds : 180}s`;
      console.log(`   📹 Video omitted (${reason})`);
    }

    const transcriptTimecoded = buildEstimatedTimecodedTranscript(transcript, durationSeconds, 36);

        const judgePrompt = `
You are a professional NSDA impromptu judge for BALLOT.

═══════════════════════════════════════════════════════════════════════════════
STEP 0: CLASSIFY THE SPEECH (MANDATORY FIRST STEP)
═══════════════════════════════════════════════════════════════════════════════
Before scoring, you MUST classify the speech into ONE of these categories:

- "normal": Coherent speech addressing the topic with identifiable structure
- "too_short": Speech under 60 seconds OR transcript under 100 words
- "nonsense": Word salad, random words, gibberish, incoherent rambling with no logical thread
- "off_topic": Speech is coherent but completely ignores the quote/theme (discusses unrelated subject)
- "mostly_off_topic": Speech has minimal connection to quote/theme (>70% off-topic content)

HARD SCORE CAPS BY CLASSIFICATION:
- "too_short" / "nonsense" / "off_topic" → overallScore MAXIMUM 2.5 (all category scores ≤ 3.0)
- "mostly_off_topic" → overallScore MAXIMUM 6.0 (content scores ≤ 5.0)
- "normal" → No cap; score using full rubric

Set capsApplied=true if any cap was enforced, false otherwise.

═══════════════════════════════════════════════════════════════════════════════
SCORING BANDS (NSDA-calibrated, use full 0–10 range)
═══════════════════════════════════════════════════════════════════════════════
9.0–10.0: Finals-caliber; exceptional execution, flawless structure, original insights
8.0–8.9:  Breaking rounds; solid competitive performance, clear strengths
7.0–7.9:  Competitive; functional structure, adequate analysis, some weaknesses  
5.0–6.9:  Developing; noticeable gaps in structure, depth, or delivery
3.0–4.9:  Significant problems; major fundamental issues
0.0–2.9:  Minimal skill demonstration; incoherent, off-topic, or severely deficient

LENGTH PENALTIES (apply to Content score BEFORE weighted calculation):
- <3:00 → -2.0 + flag "⚠️ INSUFFICIENT LENGTH"
- 3:00–3:59 → -1.0 + note "Below optimal range"
- 4:00–6:00 → no penalty (optimal)
- >7:00 → -0.5 to Time Management + flag "⚠️ EXCEEDS LIMIT"

WEIGHTED FORMULA:
Overall = (Content × 0.40) + (Delivery × 0.30) + (Language × 0.15) + (Body Language × 0.15)

tournamentReady=true ONLY if: overallScore ≥ 7.5 AND all categories ≥ 7.0 AND length 4:00–7:00 AND fillers < 8/min AND eye contact > 50%

═══════════════════════════════════════════════════════════════════════════════
INPUT DATA
═══════════════════════════════════════════════════════════════════════════════
THEME: ${input.theme}
QUOTE: ${input.quote}
DURATION: ${Math.round(durationSeconds)}s (${durationSeconds > 0 ? formatDurationSeconds(durationSeconds) : 'Unknown'})

TRANSCRIPT (with estimated time-codes):
"""
${transcriptTimecoded}
"""

═══════════════════════════════════════════════════════════════════════════════
SCORING PROCEDURE (FOLLOW THIS ORDER)
═══════════════════════════════════════════════════════════════════════════════
1. CLASSIFY first (Step 0 above). Set "classification" field.
2. If classification triggers a cap, apply it. Set "capsApplied" accordingly.
3. For each metric: decide score FIRST based on evidence, THEN write feedback justifying that score.
4. Scores MUST vary: if performance differs across metrics, scores MUST differ by ≥0.5 points.
5. Typical spread: scores should range 2+ points (e.g., 5.8 to 8.2). Flat distributions indicate scoring failure.

ANTI-HALLUCINATION: Use ONLY quotes and time ranges from the transcript above. Do NOT invent content.

═══════════════════════════════════════════════════════════════════════════════
FEEDBACK FORMAT REQUIREMENTS (CRITICAL - INDIVIDUALIZED FEEDBACK)
═══════════════════════════════════════════════════════════════════════════════
Every "feedback" field MUST contain EXACTLY 4 labeled sections. This structure is NON-NEGOTIABLE.

**Score Justification:** (3-5 sentences REQUIRED)
Write a "because-chain" of reasoning. Start with the score decision, then explain WHY using 2-3 "because" connections.
Example pattern: "This earns a 7.3 because [observation]. This matters because [competitive impact]. The speaker demonstrates [specific skill] because [evidence]."
MUST end with ONE sentence: "This did not reach [X.X] because [specific gap that prevented higher band]."

**Evidence from Speech:** (EXACTLY 2 bullets REQUIRED)
- '[exact 5-15 word quote from transcript]' [m:ss-m:ss] — [why this quote demonstrates the score]
- '[exact 5-15 word quote from transcript]' [m:ss-m:ss] — [why this quote demonstrates the score]
CRITICAL: Quotes MUST be verbatim substrings from the transcript. If transcript lacks timecodes, write "[no timecode available]" - do NOT invent timestamps.

**What This Means:** (2 sentences MAX)
Competitive tournament implication. What would judges notice? How does this affect ranking?

**How to Improve:** (Actionable drill + measurable goal)
One specific practice drill with a MEASURABLE target. Format: "[Drill name]: [Exact steps]. Goal: [Quantifiable metric to hit by next session]."
Example: "Pause Mapping Drill: Record yourself, mark 3 intentional 1.5-second pauses at transitions. Goal: Achieve 3 deliberate pauses per minute within 2 sessions."

STRICT CONSTRAINTS:
- Each feedback string: MAX 900 characters total (truncate if over)
- Do NOT reuse any 10+ word phrase across different feedback fields (uniqueness required)
- Use single quotes for transcript quotes inside JSON strings (double quotes break JSON)
- Evidence quotes MUST actually appear in the transcript - if you cannot find a direct quote, say "No direct quote available" rather than fabricating
- Vary sentence structure across fields - avoid templated/repetitive phrasing

═══════════════════════════════════════════════════════════════════════════════
JSON OUTPUT RULES
═══════════════════════════════════════════════════════════════════════════════
- Return ONLY valid JSON. No markdown, no code fences, no commentary.
- All scores: one decimal (e.g., 6.3, 8.7). Never whole numbers. Never 0–100 scale.
- categoryScores.*.weighted = score × weight. overallScore = sum of weighted.
- CRITICAL: Example values below are INVALID PLACEHOLDERS (all 0.0). NEVER copy scores from examples.
  You MUST compute your own scores based on the actual transcript evidence.

{
  "classification": "normal",
  "capsApplied": false,
  "overallScore": 0.0,
  "performanceTier": "Developing",
  "tournamentReady": false,
  "categoryScores": {
    "content": {"score": 0.0, "weight": 0.40, "weighted": 0.0},
    "delivery": {"score": 0.0, "weight": 0.30, "weighted": 0.0},
    "language": {"score": 0.0, "weight": 0.15, "weighted": 0.0},
    "bodyLanguage": {"score": 0.0, "weight": 0.15, "weighted": 0.0}
  },
  "contentAnalysis": {
    "topicAdherence": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "argumentStructure": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "depthOfAnalysis": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "examplesEvidence": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "timeManagement": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"}
  },
  "deliveryAnalysis": {
    "vocalVariety": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "pacing": {"score": 0.0, "wpm": 0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "articulation": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "fillerWords": {"score": 0.0, "total": 0, "perMinute": 0.0, "breakdown": {}, "feedback": "YOUR_ASSESSMENT_HERE"}
  },
  "languageAnalysis": {
    "vocabulary": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "rhetoricalDevices": {"score": 0.0, "examples": [], "feedback": "YOUR_ASSESSMENT_HERE"},
    "emotionalAppeal": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "logicalAppeal": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"}
  },
  "bodyLanguageAnalysis": {
    "eyeContact": {"score": 0.0, "percentage": 0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "gestures": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "posture": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"},
    "stagePresence": {"score": 0.0, "feedback": "YOUR_ASSESSMENT_HERE"}
  },
  "speechStats": {
    "duration": "0:00",
    "wordCount": 0,
    "wpm": 0,
    "fillerWordCount": 0,
    "fillerWordRate": 0.0
  },
  "structureAnalysis": {
    "introduction": {"timeRange": "0:00-0:00", "assessment": "YOUR_ASSESSMENT_HERE"},
    "bodyPoints": [],
    "conclusion": {"timeRange": "0:00-0:00", "assessment": "YOUR_ASSESSMENT_HERE"}
  },
  "priorityImprovements": [],
  "strengths": [],
  "practiceDrill": "YOUR_DRILL_HERE",
  "nextSessionFocus": {"primary": "YOUR_FOCUS_HERE", "metric": "YOUR_METRIC_HERE"}
}
    `.trim();

        // Schema for repair pass - uses type hints only, NOT literal "string" values
        // The repair pass should preserve original content from the model, only fixing JSON syntax
        const analysisSchemaForRepair = `{
  "classification": <"normal"|"too_short"|"nonsense"|"off_topic"|"mostly_off_topic">,
  "capsApplied": <boolean>,
  "overallScore": <number 0.0-10.0>,
  "performanceTier": <"Developing"|"Competitive"|"Breaking"|"Finals">,
  "tournamentReady": <boolean>,
  "categoryScores": {
    "content": {"score": <number>, "weight": 0.40, "weighted": <number>},
    "delivery": {"score": <number>, "weight": 0.30, "weighted": <number>},
    "language": {"score": <number>, "weight": 0.15, "weighted": <number>},
    "bodyLanguage": {"score": <number>, "weight": 0.15, "weighted": <number>}
  },
  "contentAnalysis": {
    "topicAdherence": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "argumentStructure": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "depthOfAnalysis": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "examplesEvidence": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "timeManagement": {"score": <number>, "feedback": <4-section feedback string max 900 chars>}
  },
  "deliveryAnalysis": {
    "vocalVariety": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "pacing": {"score": <number>, "wpm": <number>, "feedback": <4-section feedback string max 900 chars>},
    "articulation": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "fillerWords": {"score": <number>, "total": <number>, "perMinute": <number>, "breakdown": <object>, "feedback": <4-section feedback string max 900 chars>}
  },
  "languageAnalysis": {
    "vocabulary": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "rhetoricalDevices": {"score": <number>, "examples": <array of strings>, "feedback": <4-section feedback string max 900 chars>},
    "emotionalAppeal": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "logicalAppeal": {"score": <number>, "feedback": <4-section feedback string max 900 chars>}
  },
  "bodyLanguageAnalysis": {
    "eyeContact": {"score": <number>, "percentage": <number 0-100>, "feedback": <4-section feedback string max 900 chars>},
    "gestures": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "posture": {"score": <number>, "feedback": <4-section feedback string max 900 chars>},
    "stagePresence": {"score": <number>, "feedback": <4-section feedback string max 900 chars>}
  },
  "speechStats": {
    "duration": <string like "4:32">,
    "wordCount": <number>,
    "wpm": <number>,
    "fillerWordCount": <number>,
    "fillerWordRate": <number>
  },
  "structureAnalysis": {
    "introduction": {"timeRange": <string like "0:00-0:35">, "assessment": <string>},
    "bodyPoints": [{"timeRange": <string>, "assessment": <string>}],
    "conclusion": {"timeRange": <string>, "assessment": <string>}
  },
  "priorityImprovements": [{"priority": <number>, "issue": <string>, "action": <string>, "impact": <string>}],
  "strengths": [<string>, ...],
  "practiceDrill": <string>,
  "nextSessionFocus": {"primary": <string>, "metric": <string>}
}`;

    // Track parse metrics for the judge call
    let parseMetrics: ParseMetrics = { parseFailCount: 0, repairUsed: false };
    let analysis: any;
    
    try {
      const judgeResult = await callOpenRouterJson({
        apiKey,
        model: modelName,
        messages: [
          {
            role: 'user',
            content: base64Video
              ? [
                  { type: 'text', text: judgePrompt },
                  { type: 'video_url', video_url: { url: base64Video } },
                ]
              : [{ type: 'text', text: judgePrompt }],
          },
        ],
        maxTokens: 7000,
        sampling: JUDGE_SAMPLING,
        schemaForRepair: analysisSchemaForRepair,
      });
      
      analysis = judgeResult.data;
      parseMetrics = judgeResult.parseMetrics;
      
      if (parseMetrics.repairUsed) {
        console.log(`   🔧 Parse repair was used for judge output`);
      }
    } catch (judgeError) {
      // TASK C: Handle JSON parse failure - DO NOT return default scores
      if (judgeError instanceof JsonParseError) {
        console.error(`❌ Judge LLM returned invalid JSON (parseFailCount=${judgeError.parseFailCount}, repairAttempted=${judgeError.repairAttempted})`);
        console.error(`   Raw output preview: ${judgeError.rawOutput.slice(0, 200)}...`);
        
        return {
          success: false,
          transcript,
          error: 'Analysis failed: Model returned invalid JSON that could not be parsed or repaired.',
          errorDetails: {
            type: 'parse_failure',
            message: judgeError.message,
            rawModelOutput: judgeError.rawOutput,
          },
          transcriptIntegrity,
          parseMetrics: {
            parseFailCount: judgeError.parseFailCount,
            repairUsed: judgeError.repairAttempted,
            rawOutput: judgeError.rawOutput,
          },
        };
      }
      
      // Re-throw other errors
      throw judgeError;
    }

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

    // Enforce classification-based hard caps (nonsense/off-topic detection)
    enforceClassificationCapsInPlace(analysis, transcript, durationSecondsActual);

    // Apply rubric length penalties and enforce rubric-derived tournament readiness + tier.
    applyLengthPenaltiesInPlace(analysis, durationSecondsActual);
    
    // Determine body language assessability from framing data
    const bodyLanguageAssessable = isBodyLanguageAssessable(input.framing);
    analysis.bodyLanguageAssessable = bodyLanguageAssessable;
    console.log(`   📷 Body language assessable: ${bodyLanguageAssessable} (framing: ${JSON.stringify(input.framing || {})})`);

    if (bodyLanguageAssessable) {
      // Normal path: compute category scores including body language
      computeCategoryScoresFromSubscoresInPlace(analysis);
    } else {
      // Body language not assessable: null out scores and renormalize weights
      applyBodyLanguageNotAssessableInPlace(analysis);
      console.log('   ⚠️ Body language set to NOT assessable - weights renormalized');
    }

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
      bodyLanguageAssessable ? analysis.bodyLanguageAnalysis?.eyeContact?.percentage : undefined,
      bodyLanguageAssessable
    );

    // Final enforcement of classification caps (after all score recomputation)
    const classification = analysis.classification as SpeechClassification;
    if (classification === 'too_short' || classification === 'nonsense' || classification === 'off_topic') {
      analysis.overallScore = Math.min(analysis.overallScore, 2.5);
      analysis.capsApplied = true;
    } else if (classification === 'mostly_off_topic') {
      analysis.overallScore = Math.min(analysis.overallScore, 6.0);
      analysis.capsApplied = true;
    }

    // Apply heuristic pre-check cap (from TASK B) - ensures server-side enforcement
    if (heuristicResult.maxOverallScore < 10.0) {
      const prevScore = analysis.overallScore;
      analysis.overallScore = Math.min(analysis.overallScore, heuristicResult.maxOverallScore);
      if (analysis.overallScore < prevScore) {
        analysis.capsApplied = true;
        console.log(`   🔒 Heuristic cap applied: ${prevScore} → ${analysis.overallScore} (max ${heuristicResult.maxOverallScore})`);
      }
    }

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
    
    // Truncate any overly long feedback strings to 900 chars
    truncateFeedbackInPlace(analysis, 900);
    
    // Validate feedback quality (evidence bullets, quote verification)
    const feedbackValidation = validateAnalysisFeedback(analysis, transcript);
    if (!feedbackValidation.isValid) {
      console.log(`   ⚠️ Feedback validation issues detected (${feedbackValidation.warnings.length} warnings):`);
      for (const warning of feedbackValidation.warnings.slice(0, 5)) {
        console.log(`      - ${warning}`);
      }
      if (feedbackValidation.warnings.length > 5) {
        console.log(`      ... and ${feedbackValidation.warnings.length - 5} more`);
      }
      // Add warning to response but don't fail (guarded fallback)
      const validationWarning = `Feedback quality check: ${feedbackValidation.warnings.length} issues found (some evidence may be incomplete)`;
      analysisWarning = analysisWarning 
        ? `${analysisWarning}; ${validationWarning}`
        : validationWarning;
    } else {
      console.log('   ✓ Feedback validation passed');
    }
    
    console.log('✅ Analysis successful!');
    return {
      success: true,
      transcript,
      analysis,
      transcriptIntegrity,
      parseMetrics,
      ...(analysisWarning ? { analysisWarning } : {}),
    };

  } catch (error) {
    // TASK C: Handle JsonParseError specially - return structured error info
    if (error instanceof JsonParseError) {
      console.error(`❌ Analysis failed due to JSON parse error`);
      console.error(`   parseFailCount: ${error.parseFailCount}, repairAttempted: ${error.repairAttempted}`);
      return {
        success: false,
        transcript: '',
        error: error.message,
        errorDetails: {
          type: 'parse_failure',
          message: error.message,
          rawModelOutput: error.rawOutput,
        },
        parseMetrics: {
          parseFailCount: error.parseFailCount,
          repairUsed: error.repairAttempted,
          rawOutput: error.rawOutput,
        },
      };
    }
    
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

// ===========================================
// CHAMPIONSHIP FORMAT ANALYSIS FUNCTION
// ===========================================

export async function analyzeSpeechChampionship(
  input: GeminiAnalysisInput
): Promise<GeminiChampionshipResult> {
  const apiKey = getApiKey();
  const modelName = getModel();

  if (!apiKey) {
    return {
      success: false,
      transcript: '',
      error: 'OPENROUTER_API_KEY not found in environment variables.',
    };
  }

  console.log(`\n🏆 Analyzing via OpenRouter [Championship Mode, Model: ${modelName}]...`);
  console.log(`   Video path: ${input.videoPath}`);

  try {
    // Duration detection (same as legacy)
    let durationSeconds: number | null = null;
    try {
      durationSeconds = await getVideoDurationSecondsRobust(input.videoPath);
    } catch (e) {
      console.warn(`⚠️ ffprobe could not determine duration. Attempting transcode fallback...`);
      try {
        const transcoded = await transcodeVideoForAnalysis(input.videoPath);
        durationSeconds = await getVideoDurationSecondsRobust(transcoded);
      } catch {
        durationSeconds = input.durationSecondsHint || 0;
        console.warn(`⚠️ Using client hint: ${durationSeconds}s`);
      }
    }

    console.log(`   🎞️  Duration: ${durationSeconds > 0 ? formatDurationSeconds(durationSeconds) : 'Unknown'}`);

    // Video processing (same as legacy)
    const originalSizeMb = await statSizeMB(input.videoPath);
    let videoPathForAnalysis = input.videoPath;
    let analysisWarning: string | undefined;
    let useVideoForAnalysis = true;
    const VIDEO_SIZE_LIMIT_MB = 20;

    if (originalSizeMb > 12) {
      try {
        videoPathForAnalysis = await transcodeVideoForAnalysis(input.videoPath);
      } catch {
        if (originalSizeMb <= VIDEO_SIZE_LIMIT_MB) {
          analysisWarning = 'Video compression failed; using original.';
        } else {
          useVideoForAnalysis = false;
          analysisWarning = 'Video compression failed; using audio-only.';
        }
      }
    }

    // ----------------------------
    // Audio extraction and transcription (using OpenRouter like legacy)
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
        const result = await callOpenRouterJson({
          apiKey,
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: transcribePrompt },
                { type: 'input_audio', input_audio: { data: b64, format: 'wav' } },
              ],
            },
          ],
          maxTokens: 4000,
          sampling: TRANSCRIBE_SAMPLING,
          schemaForRepair: `{"transcript":"<full transcribed text>"}`,
        });
        return typeof result.data?.transcript === 'string' ? result.data.transcript : '';
      } catch (e) {
        // Fallback: some providers expect audio_url data URL
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`⚠️ input_audio transcription failed for model=${model} (${msg}). Retrying with audio_url...`);
        const result = await callOpenRouterJson({
          apiKey,
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: transcribePrompt },
                { type: 'audio_url', audio_url: { url: `data:audio/wav;base64,${b64}` } },
              ],
            },
          ],
          maxTokens: 4000,
          sampling: TRANSCRIBE_SAMPLING,
          schemaForRepair: `{"transcript":"<full transcribed text>"}`,
        });
        return typeof result.data?.transcript === 'string' ? result.data.transcript : '';
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

    // If we have a long recording but got a tiny transcript, retry by chunking.
    const audioBytes = await fs.promises.stat(audioPath).then((s) => s.size).catch(() => 0);
    const audioDurationEstimated = audioBytes > 0 ? estimateWavDurationSecondsFromBytes(audioBytes) : 0;
    const audioDurationBest = audioDurationSeconds > 0 ? audioDurationSeconds : audioDurationEstimated;
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

    if (!transcript) {
      return {
        success: false,
        transcript: '',
        error: 'Transcription failed - no speech detected or API issue. Please check your microphone.',
      };
    }

    // Compute metrics (transcriptWordCount already computed above during transcription)
    const { total: fillerTotal, breakdown: fillerBreakdown } = countFillers(transcript);
    const durationSecondsActual = durationSeconds && durationSeconds > 0 ? durationSeconds : (input.durationSecondsHint || 1);
    const wpm = Math.round((transcriptWordCount / Math.max(durationSecondsActual, 1)) * 60);
    const fillerPerMin = Number(((fillerTotal / Math.max(durationSecondsActual, 1)) * 60).toFixed(1));
    const durationText = formatDurationSeconds(durationSecondsActual);

    // Transcript integrity
    const transcriptIntegrity = computeTranscriptIntegrity(transcript);
    console.log(`   🔐 Transcript: ${transcriptIntegrity.wordCount} words, ${transcriptIntegrity.charLen} chars`);

    // Heuristic pre-check
    const heuristicResult = classifyTranscriptHeuristic(transcript, input.theme, input.quote);
    console.log(`   🔍 Heuristic: ${heuristicResult.classification} (skipLLM=${heuristicResult.skipLLM})`);

    // If heuristic says skip LLM, return capped analysis
    if (heuristicResult.skipLLM) {
      const classification = heuristicResult.classification as 'too_short' | 'nonsense' | 'off_topic';
      const championshipAnalysis = buildInsufficientChampionshipAnalysis(
        input.theme,
        input.quote,
        transcript,
        durationSecondsActual,
        transcriptWordCount,
        wpm,
        fillerTotal,
        fillerPerMin,
        classification,
        heuristicResult.reason,
        modelName
      );

      console.warn(`⚠️ Heuristic pre-check triggered. Classification: ${classification}`);
      return {
        success: true,
        transcript,
        championshipAnalysis,
        transcriptIntegrity,
      };
    }

    // Build the championship prompt
    const transcriptTimecoded = buildEstimatedTimecodedTranscript(transcript, durationSecondsActual, 36);
    const championshipPrompt = buildChampionshipJudgePrompt(
      input.theme,
      input.quote,
      transcriptTimecoded,
      durationSecondsActual,
      durationText,
      transcriptWordCount,
      wpm,
      fillerTotal,
      fillerPerMin,
      null // pausesPerMin not available
    );

    // Call the LLM
    let parseMetrics: ParseMetrics = { parseFailCount: 0, repairUsed: false };
    let analysis: any;

    try {
      const judgeResult = await callOpenRouterJson({
        apiKey,
        model: modelName,
        messages: [{ role: 'user', content: [{ type: 'text', text: championshipPrompt }] }],
        maxTokens: 12000, // Championship format is larger
        sampling: JUDGE_SAMPLING,
        schemaForRepair: CHAMPIONSHIP_SCHEMA_FOR_REPAIR,
      });

      analysis = judgeResult.data;
      parseMetrics = judgeResult.parseMetrics;

      if (parseMetrics.repairUsed) {
        console.log(`   🔧 Parse repair was used for championship output`);
      }
    } catch (judgeError) {
      if (judgeError instanceof JsonParseError) {
        console.error(`❌ Championship judge returned invalid JSON`);
        return {
          success: false,
          transcript,
          error: 'Analysis failed: Model returned invalid JSON.',
          errorDetails: {
            type: 'parse_failure',
            message: judgeError.message,
            rawModelOutput: judgeError.rawOutput,
          },
          transcriptIntegrity,
          parseMetrics: {
            parseFailCount: judgeError.parseFailCount,
            repairUsed: judgeError.repairAttempted,
            rawOutput: judgeError.rawOutput,
          },
        };
      }
      throw judgeError;
    }

    // Cast to ChampionshipAnalysis and apply server-side corrections
    const championshipAnalysis = analysis as ChampionshipAnalysis;

    // Set version
    championshipAnalysis.version = 'championship-v1';

    // Set meta
    championshipAnalysis.meta = {
      roundType: 'impromptu',
      theme: input.theme,
      quote: input.quote,
      model: modelName,
      generatedAt: new Date().toISOString(),
    };

    // Override speechStats with computed values
    championshipAnalysis.speechStats = {
      durationSec: durationSecondsActual,
      durationText,
      wordCount: transcriptWordCount,
      wpm,
      fillerWordCount: fillerTotal,
      fillerPerMin,
      pausesPerMin: null,
    };

    // Set speechRecord
    championshipAnalysis.speechRecord = {
      transcript,
      timecodeNote: 'Timecodes are estimated based on word position',
    };

    // Update delivery metrics snapshot
    if (championshipAnalysis.deliveryMetricsCoaching?.snapshot) {
      championshipAnalysis.deliveryMetricsCoaching.snapshot = {
        wpm,
        fillerPerMin,
        durationText,
        wordCount: transcriptWordCount,
        pausesPerMin: null,
      };
    }

    // Recompute weighted scores (server-side truth)
    recomputeChampionshipScoresInPlace(championshipAnalysis);

    // Apply classification caps
    enforceChampionshipCapsInPlace(championshipAnalysis);

    // Also apply heuristic caps if needed
    if (heuristicResult.maxOverallScore < 10.0) {
      if (championshipAnalysis.scoring.overallScore > heuristicResult.maxOverallScore) {
        championshipAnalysis.scoring.overallScore = heuristicResult.maxOverallScore;
        championshipAnalysis.classification.capsApplied = true;
        championshipAnalysis.classification.maxOverallScore = heuristicResult.maxOverallScore;
        console.log(`   🔒 Heuristic cap applied: max ${heuristicResult.maxOverallScore}`);
      }
    }

    // Enforce tournament readiness
    enforceChampionshipTournamentReadiness(championshipAnalysis, fillerPerMin, durationSecondsActual);

    // Recalculate tier after all caps
    championshipAnalysis.scoring.performanceTier = computeChampionshipTier(championshipAnalysis.scoring.overallScore);

    // Ensure warnings array exists
    if (!Array.isArray(championshipAnalysis.warnings)) {
      championshipAnalysis.warnings = [];
    }

    // Add any analysis warnings
    if (analysisWarning) {
      championshipAnalysis.warnings.push(analysisWarning);
    }

    console.log('✅ Championship analysis successful!');
    console.log(`   Score: ${championshipAnalysis.scoring.overallScore} (${championshipAnalysis.scoring.performanceTier})`);

    return {
      success: true,
      transcript,
      championshipAnalysis,
      transcriptIntegrity,
      parseMetrics,
      ...(analysisWarning ? { analysisWarning } : {}),
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Championship analysis failed:', msg);
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
