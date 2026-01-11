/**
 * Type Definitions for Speech Practice App
 * 
 * These TypeScript types help us catch errors early and
 * make the code more readable and self-documenting.
 */

// Response from /api/start-round
export interface RoundData {
  theme: string;
  quotes: string[];
}

// Response from /api/upload
export interface UploadResponse {
  sessionId: string;
  jobId: string;        // Now returned by upload endpoint
  filePath: string;
  message: string;
}

// Response from /api/process-audio
export interface TranscriptResponse {
  transcript: string;
  isMock?: boolean;
}

// Response from /api/analyze-video
export interface VideoAnalysisResponse {
  sessionId: string;
  videoSummary: string;
  isMock?: boolean;
}

/**
 * Camera framing metadata for body language assessment eligibility.
 * All three must be true for body language to be assessable.
 */
export interface FramingData {
  headVisible: boolean;
  torsoVisible: boolean;
  handsVisible: boolean;
}

// Structured feedback from Gemini (Competitive NSDA Standard)
export interface DebateAnalysis {
  /** Speech classification from heuristic and/or model analysis */
  classification?: 'normal' | 'too_short' | 'nonsense' | 'off_topic' | 'mostly_off_topic';
  /** Whether score caps were applied due to classification */
  capsApplied?: boolean;
  /** 
   * Whether body language can be assessed based on camera framing.
   * If false, bodyLanguage scores are null and weights are renormalized.
   */
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
}

// Speech statistics
export interface SpeechStats {
  durationSeconds: number;
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
}

// ===========================================
// CHAMPIONSHIP-V1 TYPES (New Judging System)
// ===========================================

/** Championship output version identifier */
export type ChampionshipVersion = 'championship-v1';

/** Speech classification labels for capping */
export type SpeechClassificationLabel = 'normal' | 'too_short' | 'nonsense' | 'off_topic' | 'mostly_off_topic';

/** Evidence label types */
export type EvidenceLabel = 'STRENGTH' | 'GAP';

/** Evidence item (quote or metric) */
export interface ChampionshipEvidence {
  id: string;
  type: 'QUOTE' | 'METRIC';
  label: EvidenceLabel;
  // For QUOTE type
  quote?: string;
  timeRange?: string;
  // For METRIC type
  metric?: {
    name: string;
    value: number;
    unit: string;
  };
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
  counterexampleKit: {
    counterexampleLine: string;
    resolutionLine: string;
  };
  drill: LeverDrill;
}

/** Micro-rewrite (before/after improvement) */
export interface ChampionshipMicroRewrite {
  before: {
    quote: string;
    timeRange: string;
  };
  after: string;
  whyStronger: string;
  evidenceIds: string[];
}

/** Action plan checklist item */
export interface ChecklistItem {
  step: number;
  instruction: string;
  successCriteria: string;
}

/** Delivery metrics coaching section */
export interface DeliveryMetricsCoaching {
  snapshot: {
    wpm: number;
    fillerPerMin: number;
    durationText: string;
    wordCount: number;
    pausesPerMin: number | null;
  };
  drill: LeverDrill;
}

/** Championship analysis result (complete ballot) */
export interface ChampionshipAnalysis {
  version: ChampionshipVersion;
  meta: {
    roundType: string;
    theme: string;
    quote: string;
    model: string;
    generatedAt: string;
  };
  classification: {
    label: SpeechClassificationLabel;
    capsApplied: boolean;
    maxOverallScore: number | null;
    reasons: string[];
  };
  speechRecord: {
    transcript: string;
    timecodeNote: string;
  };
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
    weights: {
      argumentStructure: number;
      depthWeighing: number;
      rhetoricLanguage: number;
    };
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
    whyThisScore: Array<{
      claim: string;
      evidenceIds: string[];
    }>;
    whyNotHigher: {
      nextBand: string;
      blockers: Array<{
        blocker: string;
        evidenceIds: string[];
      }>;
    };
  };
  evidence: ChampionshipEvidence[];
  levers: ChampionshipLever[];
  microRewrites: ChampionshipMicroRewrite[];
  deliveryMetricsCoaching: DeliveryMetricsCoaching;
  actionPlan: {
    nextRoundChecklist: [ChecklistItem, ChecklistItem, ChecklistItem];
    warmup5Min: [string, string, string];
    duringSpeechCues: [string, string];
    postRoundReview: [string, string, string];
  };
  warnings: string[];
}

/** Combined analysis type that can be either legacy or championship */
export type AnyAnalysis = DebateAnalysis | ChampionshipAnalysis;

/** Type guard to check if analysis is championship format */
export function isChampionshipAnalysis(analysis: AnyAnalysis): analysis is ChampionshipAnalysis {
  return (analysis as ChampionshipAnalysis).version === 'championship-v1';
}

/** Transcript integrity metadata for logging and suspicious activity detection */
export interface TranscriptIntegrity {
  wordCount: number;
  charLen: number;
  sha256: string;
  isSuspicious: boolean;
  suspiciousReason?: string;
}

/** Parse/repair metrics for tracking LLM output reliability */
export interface ParseMetrics {
  parseFailCount: number;
  repairUsed: boolean;
  rawOutput?: string;
}

/** Structured error details when analysis fails */
export interface AnalysisErrorDetails {
  type: 'parse_failure' | 'schema_validation' | 'model_error' | 'transcription_error';
  message: string;
  rawModelOutput?: string;
}

// Response from /api/process-all (initial queue response)
export interface ProcessAllResponse {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  progress: number;       // 0-100 progress percentage
}

// Job status types for async processing
export type JobStatus = 'queued' | 'processing' | 'complete' | 'error';

// Response from /api/analysis-status (polling endpoint)
export interface AnalysisStatusResponse {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  progress: number;       // 0-100 progress percentage
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  // Present when status is 'complete'
  transcript?: string;
  analysis?: DebateAnalysis | ChampionshipAnalysis;
  isMock?: boolean;
  // Present when status is 'error'
  error?: string;
}

// Response from /api/process-all (legacy format for backward compatibility)
export interface FeedbackResponse {
  sessionId: string;
  transcript: string;
  analysis?: DebateAnalysis | ChampionshipAnalysis;
  isMock?: boolean;
  /** Present when analysis failed */
  error?: string;
  /** Structured error info when parsing/validation fails */
  errorDetails?: AnalysisErrorDetails;
  /** Transcript integrity metadata for logging */
  transcriptIntegrity?: TranscriptIntegrity;
  /** Parse/repair metrics */
  parseMetrics?: ParseMetrics;
  /** Warning about analysis quality (e.g., video compression failed, used audio-only) */
  analysisWarning?: string;
}

// The different screens/steps in our practice flow
export type FlowStep = 
  | 'start'          // Initial screen with "Start Round" button
  | 'theme-preview'  // User sees theme, can change or proceed
  | 'quote-select'   // User selects a quote
  | 'prep'           // Preparation timer countdown
  | 'record'         // Camera preview and recording
  | 'processing'     // Processing audio and video
  | 'insufficient'   // Transcript/audio too short to score competitively
  | 'report'         // Final feedback report (live)
  | 'ballot';        // Viewing a past ballot (fetched by ID)

// Speech format types (High School vs Middle School)
export type SpeechFormat = 'high-school' | 'middle-school';

// Format configuration
export interface FormatConfig {
  name: string;
  prepDuration: number;      // Prep time in seconds
  recordDuration: number;    // Base recording time in seconds
}

export const SPEECH_FORMATS: Record<SpeechFormat, FormatConfig> = {
  'high-school': {
    name: 'High School Impromptu',
    prepDuration: 120,    // 2 minutes
    recordDuration: 300,  // 5 minutes
  },
  'middle-school': {
    name: 'Middle School Impromptu',
    prepDuration: 180,    // 3 minutes
    recordDuration: 240,  // 4 minutes
  },
};
