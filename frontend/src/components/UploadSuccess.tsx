/**
 * UploadSuccess Component (Processing Screen)
 * 
 * Shows processing status after the video has been uploaded.
 * Automatically fetches in sequence:
 * 1. The transcript from Qwen2-Audio
 * 2. Body language analysis from Qwen2.5-VL
 * 3. Comprehensive feedback from DeepSeek
 * 
 * When all processing is complete, calls onFeedbackReady to show the report.
 */

import { useState, useEffect, useCallback } from 'react';
import { UploadResponse, TranscriptResponse, VideoAnalysisResponse, FeedbackResponse, DebateFeedback, SpeechStats } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Props that this component receives from its parent
interface UploadSuccessProps {
  uploadResponse: UploadResponse;
  theme: string;                    // Theme of the round (for feedback)
  quote: string;                    // Selected quote (for feedback)
  onFeedbackReady: (
    feedback: DebateFeedback, 
    isMock: boolean,
    transcript: string,
    bodyLanguageAnalysis: string,
    speechStats?: SpeechStats
  ) => void;  // Called when feedback is ready
}

function UploadSuccess({ uploadResponse, theme, quote, onFeedbackReady }: UploadSuccessProps) {
  // ===========================================
  // STATE FOR TRANSCRIPT
  // ===========================================
  
  const [transcript, setTranscript] = useState<string | null>(null);
  const [isProcessingAudio, setIsProcessingAudio] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);

  // ===========================================
  // STATE FOR BODY LANGUAGE ANALYSIS
  // ===========================================
  
  const [bodyLanguageSummary, setBodyLanguageSummary] = useState<string | null>(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // ===========================================
  // STATE FOR DEEPSEEK FEEDBACK
  // ===========================================
  
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Abort controllers so leaving the page can't cause "late" state transitions
  const abortRef = useState(() => ({
    transcript: new AbortController(),
    video: new AbortController(),
    feedback: new AbortController(),
  }))[0];

  // Cancel in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortRef.transcript.abort();
      abortRef.video.abort();
      abortRef.feedback.abort();
    };
  }, [abortRef]);

  // ===========================================
  // STEP 1: FETCH TRANSCRIPT ON MOUNT
  // ===========================================
  
  useEffect(() => {
    const fetchTranscript = async () => {
      setIsProcessingAudio(true);
      setAudioError(null);

      try {
        console.log('🔄 Step 1/3: Requesting transcription...');

        const response = await fetch(API_ENDPOINTS.processAudio, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: uploadResponse.sessionId }),
          signal: abortRef.transcript.signal,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error ${response.status}`);
        }

        const data: TranscriptResponse = await response.json();
        console.log('✅ Transcript received');
        
        setTranscript(data.transcript);
        
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('❌ Failed to fetch transcript:', err);
        setAudioError(err instanceof Error ? err.message : 'Failed to process audio');
      } finally {
        setIsProcessingAudio(false);
      }
    };

    fetchTranscript();
  }, [uploadResponse.sessionId]);

  // ===========================================
  // STEP 2: FETCH BODY LANGUAGE AFTER TRANSCRIPT
  // ===========================================
  
  useEffect(() => {
    if (isProcessingAudio) return;

    const fetchVideoAnalysis = async () => {
      setIsProcessingVideo(true);
      setVideoError(null);

      try {
        console.log('🎬 Step 2/3: Requesting body language analysis...');

        const response = await fetch(API_ENDPOINTS.analyzeVideo, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: uploadResponse.sessionId }),
          signal: abortRef.video.signal,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error ${response.status}`);
        }

        const data: VideoAnalysisResponse = await response.json();
        console.log('✅ Body language analysis received');
        
        setBodyLanguageSummary(data.videoSummary);
        
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('❌ Failed to fetch video analysis:', err);
        setVideoError(err instanceof Error ? err.message : 'Failed to analyze video');
        // Set a default message so we can still proceed to feedback
        setBodyLanguageSummary('Body language analysis unavailable.');
      } finally {
        setIsProcessingVideo(false);
      }
    };

    fetchVideoAnalysis();
  }, [isProcessingAudio, uploadResponse.sessionId]);

  // ===========================================
  // STEP 3: GENERATE FEEDBACK AFTER BOTH COMPLETE
  // ===========================================

  const generateFeedback = useCallback(async () => {
    if (!transcript || !bodyLanguageSummary) return;
    
    setIsGeneratingFeedback(true);
    setFeedbackError(null);

    try {
      console.log('🤖 Step 3/3: Generating debate feedback...');

      const response = await fetch(API_ENDPOINTS.generateFeedback, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: uploadResponse.sessionId,
          transcript,
          bodyLanguageAnalysis: bodyLanguageSummary,
          theme,
          quote,
        }),
        signal: abortRef.feedback.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data: FeedbackResponse = await response.json();
      console.log('✅ Debate feedback received');
      
      // Pass the feedback up to the parent to show the report
      // Also pass transcript, body language, and speech stats for saving to database
      onFeedbackReady(
        data.feedback, 
        data.isMock || false,
        transcript || '',
        bodyLanguageSummary || '',
        data.speechStats
      );
      
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('❌ Failed to generate feedback:', err);
      setFeedbackError(err instanceof Error ? err.message : 'Failed to generate feedback');
      setIsGeneratingFeedback(false);
    }
  }, [transcript, bodyLanguageSummary, uploadResponse.sessionId, theme, quote, onFeedbackReady]);
  
  useEffect(() => {
    // Only generate feedback when both transcript and body language are ready
    if (!isProcessingAudio && !isProcessingVideo && transcript && bodyLanguageSummary) {
      generateFeedback();
    }
  }, [isProcessingAudio, isProcessingVideo, transcript, bodyLanguageSummary, generateFeedback]);

  // ===========================================
  // RENDER
  // ===========================================

  // Calculate overall progress
  const getProgressStatus = () => {
    if (isProcessingAudio) return { step: 1, text: 'Processing audio...' };
    if (isProcessingVideo) return { step: 2, text: 'Analyzing body language...' };
    if (isGeneratingFeedback) return { step: 3, text: 'Generating feedback...' };
    if (feedbackError) return { step: 3, text: 'Error generating feedback' };
    return { step: 3, text: 'Finalizing...' };
  };

  const progress = getProgressStatus();

  // Get step status indicator
  const getStepIndicator = (
    isPending: boolean,
    isActive: boolean,
    hasError: boolean,
    isWarning: boolean = false
  ) => {
    if (isPending) return <span style={styles.stepIndicatorPending}>-</span>;
    if (isActive) return <span style={styles.stepIndicatorActive}></span>;
    if (hasError) return <span style={styles.stepIndicatorError}>!</span>;
    if (isWarning) return <span style={styles.stepIndicatorWarning}>!</span>;
    return <span style={styles.stepIndicatorDone}>&#10003;</span>;
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Analyzing Your Speech</h1>
        <p style={styles.subtitle}>
          Please wait while we process your recording...
        </p>
      </div>

      {/* Main content */}
      <div style={styles.mainContent}>
        {/* Progress Bar */}
        <div style={styles.progressSection}>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${(progress.step / 3) * 100}%`,
              }} 
            />
          </div>
          <p style={styles.progressText}>
            Step {progress.step} of 3: {progress.text}
          </p>
        </div>

        {/* Step Status List */}
        <div style={styles.stepList}>
          {/* Step 1: Audio */}
          <div style={styles.stepItem}>
            {getStepIndicator(false, isProcessingAudio, !!audioError)}
            <span style={styles.stepText}>
              Transcribe audio
              {audioError && <span style={styles.stepError}> - {audioError}</span>}
            </span>
          </div>

          {/* Step 2: Video */}
          <div style={styles.stepItem}>
            {getStepIndicator(isProcessingAudio, isProcessingVideo, false, !!videoError)}
            <span style={styles.stepText}>
              Analyze body language
              {videoError && <span style={styles.stepWarning}> - Using fallback</span>}
            </span>
          </div>

          {/* Step 3: Feedback */}
          <div style={styles.stepItem}>
            {getStepIndicator(isProcessingAudio || isProcessingVideo, isGeneratingFeedback, !!feedbackError)}
            <span style={styles.stepText}>
              Generate debate feedback
              {feedbackError && <span style={styles.stepError}> - {feedbackError}</span>}
            </span>
          </div>
        </div>

        {/* Retry button if feedback failed */}
        {feedbackError && !isGeneratingFeedback && (
          <button
            onClick={generateFeedback}
            style={styles.retryButton}
          >
            Retry Feedback Generation
          </button>
        )}

        {/* Context info */}
        <div style={styles.contextBox}>
          <p style={styles.contextLabel}>Theme: <span style={styles.contextValue}>{theme}</span></p>
          <p style={styles.contextLabel}>Quote: <span style={styles.contextQuote}>"{quote}"</span></p>
        </div>
      </div>
    </div>
  );
}

// ===========================================
// STYLES
// ===========================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '80px 48px 120px 48px',
    background: '#ffffff',
  },
  header: {
    marginBottom: '48px',
  },
  title: {
    color: '#111111',
    fontSize: '2rem',
    margin: '0 0 12px 0',
    fontWeight: 700,
  },
  subtitle: {
    color: '#666666',
    fontSize: '1.1rem',
    margin: 0,
  },
  mainContent: {
    maxWidth: '600px',
  },
  progressSection: {
    marginBottom: '32px',
  },
  progressBar: {
    height: '8px',
    background: '#e5e5e5',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '12px',
  },
  progressFill: {
    height: '100%',
    background: '#000000',
    borderRadius: '4px',
    transition: 'width 0.5s ease',
  },
  progressText: {
    color: '#666666',
    fontSize: '0.95rem',
    margin: 0,
  },
  stepList: {
    marginBottom: '32px',
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    marginBottom: '8px',
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
  },
  stepIndicatorPending: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#e5e5e5',
    color: '#999999',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: 600,
    flexShrink: 0,
  },
  stepIndicatorActive: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    border: '3px solid #000000',
    borderTopColor: 'transparent',
    animation: 'spin 1s linear infinite',
    flexShrink: 0,
  },
  stepIndicatorDone: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#059669',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  stepIndicatorError: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#dc2626',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  stepIndicatorWarning: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#d97706',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  stepText: {
    color: '#333333',
    fontSize: '0.95rem',
  },
  stepError: {
    color: '#dc2626',
    fontSize: '0.85rem',
  },
  stepWarning: {
    color: '#d97706',
    fontSize: '0.85rem',
  },
  retryButton: {
    background: '#ffffff',
    color: '#333333',
    border: '2px solid #000000',
    padding: '14px 24px',
    fontSize: '0.95rem',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '32px',
  },
  contextBox: {
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
    padding: '20px',
  },
  contextLabel: {
    color: '#666666',
    fontSize: '0.9rem',
    margin: '0 0 8px 0',
  },
  contextValue: {
    color: '#111111',
    fontWeight: 500,
  },
  contextQuote: {
    color: '#333333',
    fontStyle: 'italic',
  },
};

export default UploadSuccess;
