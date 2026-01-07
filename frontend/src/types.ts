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

// Structured feedback from Gemini (Competitive NSDA Standard)
export interface DebateAnalysis {
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
}

// Speech statistics
export interface SpeechStats {
  durationSeconds: number;
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
}

// Response from /api/process-all
export interface FeedbackResponse {
  sessionId: string;
  transcript: string;
  analysis?: DebateAnalysis;
  isMock?: boolean;
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
