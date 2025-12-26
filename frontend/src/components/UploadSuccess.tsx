/**
 * UploadSuccess Component (Processing Screen)
 * 
 * Shows processing status after the video has been uploaded.
 * Uses a single request to Gemini 2.0 Flash for multimodal analysis.
 * 
 * When analysis is complete, calls onFeedbackReady to show the report.
 */

import { useState, useEffect, useRef } from 'react';
import { UploadResponse, DebateFeedback, SpeechStats } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Props that this component receives from its parent
interface UploadSuccessProps {
  uploadResponse: UploadResponse;
  theme: string;                    // Theme of the round
  quote: string;                    // Selected quote
  onFeedbackReady: (
    feedback: DebateFeedback, 
    isMock: boolean,
    transcript: string,
    bodyLanguageAnalysis: string,
    speechStats?: SpeechStats
  ) => void;  // Called when feedback is ready
}

function UploadSuccess({ uploadResponse, theme, quote, onFeedbackReady }: UploadSuccessProps) {
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Simulate progress while waiting for the API
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        // Make progress feel responsive (up to 95%), without forcing a long wait.
        if (prev < 30) return prev + 5;      // fast ramp
        if (prev < 80) return prev + 2;      // steady
        if (prev < 95) return prev + 1;      // slow finish
        return prev;
      });
    }, 250);

    return () => clearInterval(interval);
  }, [isProcessing]);

  useEffect(() => {
    // React 18 StrictMode can run effects twice in dev; ensure we only call the API once.
    if (startedRef.current) return;
    startedRef.current = true;

    const processAll = async () => {
      setIsProcessing(true);
      setError(null);

      try {
        console.log('🌟 Requesting multimodal analysis from Gemini...');

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Hard timeout to prevent “infinite loading” UX
        const timeoutId = window.setTimeout(() => controller.abort(), 90_000);

        const response = await fetch(API_ENDPOINTS.processAll, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: uploadResponse.sessionId }),
          signal: controller.signal,
        });

        window.clearTimeout(timeoutId);

        if (!response.ok) {
          const contentType = response.headers.get('content-type') || '';
          let details = '';
          try {
            if (contentType.includes('application/json')) {
              const errorData = await response.json();
              details = errorData?.error ? String(errorData.error) : JSON.stringify(errorData);
            } else {
              details = await response.text();
            }
          } catch {
            // ignore
          }
          const suffix = details ? `: ${details}` : '';
          throw new Error(`Analysis failed (${response.status})${suffix}`);
        }

        const data: any = await response.json();
        console.log('✅ Analysis complete');
        
        setProgress(100);
        
        // Short delay to show 100% before transitioning
        setTimeout(() => {
          onFeedbackReady(
            data.feedback,
            data.isMock || false,
            data.transcript || '',
            data.videoSummary || '',
            data.speechStats
          );
        }, 500);

      } catch (err) {
        console.error('❌ Failed to process analysis:', err);
        if (err instanceof Error && err.name === 'AbortError') {
          setError('Analysis timed out. Please try again.');
        } else {
          setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.');
        }
        setIsProcessing(false);
      }
    };

    processAll();
  }, [uploadResponse.sessionId, onFeedbackReady]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Analyzing Your Speech</h1>
        <p style={styles.subtitle}>
          Gemini 2.0 Flash is "watching" and "listening" to your recording...
        </p>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.progressSection}>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${progress}%`,
              }} 
            />
          </div>
          <p style={styles.progressText}>
            {isProcessing ? `Analysis in progress: ${progress}%` : error ? 'Error occurred' : 'Analysis complete!'}
          </p>
        </div>

        {error && (
          <div style={styles.errorBox}>
            <p style={styles.errorText}>{error}</p>
            <button
              onClick={() => window.location.reload()}
              style={styles.retryButton}
            >
              Restart
            </button>
          </div>
        )}

        <div style={styles.stepList}>
          <div style={styles.stepItem}>
            <div style={isProcessing ? styles.spinner : styles.doneIcon}>
              {isProcessing ? '' : '✓'}
            </div>
            <div style={styles.stepContent}>
              <h3 style={styles.stepTitle}>Multimodal Feedback</h3>
              <p style={styles.stepDesc}>
                Gemini is generating transcription, body language analysis, and debate scores in one pass.
              </p>
            </div>
          </div>
        </div>

        <div style={styles.contextBox}>
          <p style={styles.contextLabel}>Theme: <span style={styles.contextValue}>{theme}</span></p>
          <p style={styles.contextLabel}>Quote: <span style={styles.contextQuote}>"{quote}"</span></p>
        </div>
      </div>
    </div>
  );
}

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
    fontSize: '2.5rem',
    margin: '0 0 12px 0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#666666',
    fontSize: '1.2rem',
    margin: 0,
    maxWidth: '600px',
    lineHeight: 1.5,
  },
  mainContent: {
    maxWidth: '600px',
  },
  progressSection: {
    marginBottom: '48px',
  },
  progressBar: {
    height: '4px',
    background: '#f0f0f0',
    borderRadius: '2px',
    overflow: 'hidden',
    marginBottom: '16px',
  },
  progressFill: {
    height: '100%',
    background: '#000000',
    transition: 'width 0.3s ease-out',
  },
  progressText: {
    color: '#111111',
    fontSize: '1rem',
    fontWeight: 500,
    margin: 0,
  },
  stepList: {
    marginBottom: '48px',
  },
  stepItem: {
    display: 'flex',
    gap: '20px',
    padding: '24px',
    background: '#fafafa',
    border: '1px solid #eeeeee',
    borderRadius: '12px',
    alignItems: 'flex-start',
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid #eeeeee',
    borderTop: '2px solid #000000',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    flexShrink: 0,
    marginTop: '4px',
  },
  doneIcon: {
    width: '24px',
    height: '24px',
    background: '#000000',
    color: '#ffffff',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    flexShrink: 0,
    marginTop: '4px',
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    margin: '0 0 4px 0',
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#111111',
  },
  stepDesc: {
    margin: 0,
    fontSize: '0.95rem',
    color: '#666666',
    lineHeight: 1.5,
  },
  errorBox: {
    padding: '20px',
    background: '#fff5f5',
    border: '1px solid #feb2b2',
    borderRadius: '12px',
    marginBottom: '32px',
  },
  errorText: {
    color: '#c53030',
    margin: '0 0 16px 0',
    fontSize: '0.95rem',
  },
  retryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  contextBox: {
    padding: '24px',
    border: '1px solid #eeeeee',
    borderRadius: '12px',
  },
  contextLabel: {
    color: '#666666',
    fontSize: '0.9rem',
    margin: '0 0 8px 0',
  },
  contextValue: {
    color: '#111111',
    fontWeight: 600,
  },
  contextQuote: {
    color: '#111111',
    fontStyle: 'italic',
  },
};

// Add the keyframes for the spinner
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default UploadSuccess;
