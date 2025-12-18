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

// Structured feedback from DeepSeek
export interface DebateFeedback {
  scores: {
    structure: number;    // 1-10 score for organization
    content: number;      // 1-10 score for analysis/reasoning  
    delivery: number;     // 1-10 score for vocal/physical delivery
  };
  strengths: string[];           // List of specific strengths
  improvements: string[];        // List of specific improvements
  practiceDrill: string;         // One concrete drill to practice
  contentSummary?: string;       // Brief summary of the speech content
}

// Speech statistics calculated from transcript
export interface SpeechStats {
  durationSeconds: number;
  wordCount: number;
  wordsPerMinute: number;
  fillerCount: number;
}

// Response from /api/generate-feedback
export interface FeedbackResponse {
  sessionId: string;
  feedback: DebateFeedback;
  speechStats?: SpeechStats;
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
  | 'report';        // Final feedback report
