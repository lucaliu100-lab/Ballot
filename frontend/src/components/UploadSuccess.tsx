/**
 * UploadSuccess Component (Processing Screen)
 * 
 * Shows processing status after the video has been uploaded.
 * Uses a single request to Gemini 2.0 Flash for multimodal analysis.
 * 
 * When analysis is complete, calls onFeedbackReady to show the report.
 */

import { useState, useEffect, useRef } from 'react';
import { UploadResponse, DebateAnalysis } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Props that this component receives from its parent
interface UploadSuccessProps {
  uploadResponse: UploadResponse;
  theme: string;                    // Theme of the round
  quote: string;                    // Selected quote
  onFeedbackReady: (
    analysis: DebateAnalysis, 
    isMock: boolean,
    transcript: string
  ) => void;  // Called when feedback is ready
}

function UploadSuccess({ uploadResponse, theme, quote, onFeedbackReady }: UploadSuccessProps) {
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Simulate progress while waiting for the API
  // Fast progress up to 90%, then slow crawl to give API time to respond
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        // Fast initial progress up to 90%, then very slow crawl
        // This works for both short (1-2 min) and longer (4+ min) videos
        if (prev < 30) return prev + 1.5;      // Fast initial upload/transcoding
        if (prev < 60) return prev + 1.2;      // Processing audio
        if (prev < 80) return prev + 0.8;      // AI analysis starting
        if (prev < 90) return prev + 0.4;      // Scoring in progress
        if (prev < 95) return prev + 0.08;     // Deep evaluation (slow down significantly)
        if (prev < 98) return prev + 0.03;     // Final verification (crawl)
        return prev;                            // Hold at 98% until API responds
      });
    }, 500); // 500ms interval for smoother animation

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
        console.log('🌟 Initiating professional performance evaluation...');

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Extended timeout (15 minutes) to handle concurrent uploads and longer speeches
        const timeoutId = window.setTimeout(() => controller.abort(), 900_000);

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
            data.analysis,
            data.isMock || false,
            data.transcript || ''
          );
        }, 500);

      } catch (err) {
        console.error('❌ Failed to process analysis:', err);
        if (err instanceof Error && err.name === 'AbortError') {
          setError('We’re sorry — we couldn’t generate your ballot in time. This is a known reliability issue we’re actively fixing. Please try again.');
          setErrorDetails('Request timed out while waiting for the analysis service.');
        } else {
          const raw = err instanceof Error ? err.message : 'Analysis failed. Please try again.';
          // Professional user-facing message + keep technicals available on demand.
          setError('We’re sorry — we couldn’t generate your ballot right now. This is a known reliability issue we’re actively fixing. Please try again.');
          setErrorDetails(raw);
        }
        setIsProcessing(false);
      }
    };

    processAll();
  }, [uploadResponse.sessionId, onFeedbackReady]);

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        <div style={styles.header}>
          <div style={styles.kicker}>CHAMPIONSHIP BALLOT</div>
          <h1 style={styles.title}>Evaluating Your Performance</h1>
          <p style={styles.subtitle}>
            Applying NSDA Championship Standards to your recording
          </p>
        </div>

        <div style={styles.mainContent}>
          <div style={styles.progressSection}>
            <p style={styles.progressText}>
              {isProcessing ? `Analysis in progress: ${Math.floor(progress)}%` : error ? 'Error occurred' : 'Analysis complete!'}
            </p>
            <div style={styles.progressBar}>
              <div 
                style={{
                  ...styles.progressFill,
                  width: `${progress}%`,
                }} 
              />
            </div>
          </div>

          {error && (
            <div style={styles.errorBox}>
              <p style={styles.errorText}>{error}</p>
              {errorDetails && (
                <details style={styles.errorDetails}>
                  <summary style={styles.errorDetailsSummary}>Technical details</summary>
                  <pre style={styles.errorDetailsPre}>{errorDetails}</pre>
                </details>
              )}
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
                <h3 style={styles.stepTitle}>Championship Evaluation</h3>
                <p style={styles.stepDesc}>
                  Conducting full technical analysis of argument structure, delivery metrics, and body language under competitive tournament conditions.
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

      {/* Local keyframes (avoid global stylesheet injection) */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '72px 24px 120px 24px',
    background: '#ffffff',
    maxWidth: '1280px',
    margin: '0 auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: '900px',
  },
  header: {
    marginBottom: '48px',
    textAlign: 'center',
  },
  kicker: {
    fontSize: '12px',
    color: '#6b7280',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: '10px',
  },
  title: {
    color: '#111111',
    fontSize: '36px',
    margin: '0 0 12px 0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#666666',
    fontSize: '18px',
    margin: 0,
    maxWidth: '720px',
    lineHeight: 1.5,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  mainContent: {
    maxWidth: '720px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  progressSection: {
    marginBottom: '48px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
  },
  progressBar: {
    width: '400px',
    height: '8px',
    background: '#f0f0f0',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#000000',
    borderRadius: '999px',
    transition: 'width 400ms ease',
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
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
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
  errorDetails: {
    margin: '12px 0 16px 0',
  },
  errorDetailsSummary: {
    cursor: 'pointer',
    color: '#111111',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  errorDetailsPre: {
    marginTop: '10px',
    padding: '12px',
    background: 'rgba(0,0,0,0.04)',
    borderRadius: '8px',
    fontSize: '0.8rem',
    lineHeight: 1.4,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    color: '#111111',
  },
  contextBox: {
    padding: '24px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
  },
  contextLabel: {
    color: '#6b7280',
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

export default UploadSuccess;
