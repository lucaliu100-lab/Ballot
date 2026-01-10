/**
 * UploadSuccess Component (Processing Screen)
 * 
 * Shows processing status after the video has been uploaded.
 * Uses polling to check analysis job status, enabling graceful handling
 * of classroom concurrency scenarios where initial requests may time out.
 * 
 * When analysis is complete, calls onFeedbackReady to show the report.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { UploadResponse, DebateAnalysis, ProcessAllResponse, AnalysisStatusResponse, JobStatus } from '../types';
import { API_ENDPOINTS, POLLING_CONFIG } from '../lib/constants';

// Props that this component receives from its parent
interface UploadSuccessProps {
  uploadResponse?: UploadResponse;  // May be undefined on page refresh
  theme: string;                    // Theme of the round
  quote: string;                    // Selected quote
  onFeedbackReady: (
    analysis: DebateAnalysis, 
    isMock: boolean,
    transcript: string
  ) => void;  // Called when feedback is ready
  onMissingParams?: () => void;     // Called if sessionId/jobId can't be determined
}

function UploadSuccess({ uploadResponse, theme, quote, onFeedbackReady, onMissingParams }: UploadSuccessProps) {
  // ==========================================
  // STATE
  // ==========================================
  const [jobStatus, setJobStatus] = useState<JobStatus>('queued');
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showRefreshLater, setShowRefreshLater] = useState(false);

  // ==========================================
  // REFS - Store values/callbacks to avoid effect re-runs
  // ==========================================
  const pollingIntervalRef = useRef<number | null>(null);
  const elapsedIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  
  // Store callbacks in refs so effects don't depend on them
  const onFeedbackReadyRef = useRef(onFeedbackReady);
  const onMissingParamsRef = useRef(onMissingParams);
  
  // Keep callback refs up to date (these effects are cheap and don't cause re-renders)
  useEffect(() => { onFeedbackReadyRef.current = onFeedbackReady; }, [onFeedbackReady]);
  useEffect(() => { onMissingParamsRef.current = onMissingParams; }, [onMissingParams]);

  // ==========================================
  // RESOLVE SESSION IDS
  // ==========================================
  const resolvedIds = useMemo(() => {
    // Priority 1: Use props if available
    if (uploadResponse?.sessionId && uploadResponse?.jobId) {
      return { sessionId: uploadResponse.sessionId, jobId: uploadResponse.jobId };
    }
    // Priority 2: Read from URL params (page refresh scenario)
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('sessionId');
    const jobId = params.get('jobId');
    if (sessionId && jobId) {
      console.log(`📋 [UploadSuccess] Restored session from URL params: sessionId=${sessionId}, jobId=${jobId}`);
      return { sessionId, jobId };
    }
    return null;
  }, [uploadResponse?.sessionId, uploadResponse?.jobId]);

  // ==========================================
  // PROGRESS SIMULATION
  // ==========================================
  useEffect(() => {
    if (jobStatus === 'queued') {
      setProgress(Math.min(20, elapsedTime * 2));
    } else if (jobStatus === 'processing') {
      const baseProgress = 20;
      const maxProgress = 95;
      const progressIncrement = Math.min(
        maxProgress - baseProgress,
        (maxProgress - baseProgress) * (1 - Math.exp(-elapsedTime / 60))
      );
      setProgress(Math.floor(baseProgress + progressIncrement));
    }
  }, [jobStatus, elapsedTime]);

  // ==========================================
  // MAIN POLLING EFFECT
  // ==========================================
  useEffect(() => {
    // Guard: can't start without session info
    if (!resolvedIds) {
      console.error('❌ [UploadSuccess] Missing sessionId/jobId - cannot poll for status');
      setError('Session information is missing. Please start a new round.');
      setErrorDetails('Could not find sessionId or jobId in props or URL parameters.');
      onMissingParamsRef.current?.();
      return;
    }

    const { sessionId, jobId } = resolvedIds;
    
    // Note: We intentionally DON'T use a "startedRef" to prevent re-runs.
    // React StrictMode runs effects twice, and using a ref causes the second
    // run to skip while the first run's fetch gets aborted. Instead, we let
    // each effect instance run independently - the AbortController ensures
    // only the active instance processes responses.
    
    // Local state for this effect instance
    let isActive = true;
    const abortController = new AbortController();

    // Helper: Clear all intervals
    const clearIntervals = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
    };

    // Helper: Handle completed analysis
    const handleComplete = (data: AnalysisStatusResponse) => {
      if (!isActive) return;
      
      console.log(`✅ [UploadSuccess] Analysis complete for sessionId=${sessionId}`);
      clearIntervals();
      setProgress(100);
      
      setTimeout(() => {
        if (!isActive) return;
        
        if (data.analysis) {
          onFeedbackReadyRef.current(
            data.analysis,
            data.isMock || false,
            data.transcript || ''
          );
        } else {
          setError('Analysis completed but no results were returned.');
          setErrorDetails('The server returned a complete status but the analysis data was missing.');
        }
      }, 500);
    };

    // Helper: Fetch analysis status
    const fetchStatus = async (): Promise<AnalysisStatusResponse | null> => {
      console.log(`📊 [UploadSuccess] Polling status: sessionId=${sessionId}, jobId=${jobId}`);
      
      const response = await fetch(
        `${API_ENDPOINTS.analysisStatus}?sessionId=${encodeURIComponent(sessionId)}&jobId=${encodeURIComponent(jobId)}`,
        { method: 'GET', signal: abortController.signal }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Status check failed (${response.status})`);
      }

      return response.json();
    };

    // Helper: Poll once
    const pollOnce = async () => {
      if (!isActive || abortController.signal.aborted) return;
      
      try {
        const statusData = await fetchStatus();
        if (!isActive || !statusData) return;

        // Update status
        setJobStatus(prev => {
          if (prev !== statusData.status) {
            console.log(`🔄 [UploadSuccess] Status transition: ${prev} → ${statusData.status}`);
          }
          return statusData.status;
        });

        if (statusData.status === 'complete') {
          handleComplete(statusData);
        } else if (statusData.status === 'error') {
          console.error(`❌ [UploadSuccess] Analysis error: ${statusData.error}`);
          clearIntervals();
          setError('Analysis failed. Please try again.');
          setErrorDetails(statusData.error || 'Unknown error');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('❌ [UploadSuccess] Poll error:', err);
        // Don't stop polling on transient errors
      }
    };

    // Main async flow
    const startPolling = async () => {
      try {
        console.log(`🌟 [UploadSuccess] Starting analysis for sessionId=${sessionId}, jobId=${jobId}`);
        startTimeRef.current = Date.now();

        // Step 1: Call /api/process-all to check/start the job
        const response = await fetch(API_ENDPOINTS.processAll, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          signal: abortController.signal,
        });

        if (!isActive) return;

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `Failed to start analysis (${response.status})`);
        }

        const data: ProcessAllResponse = await response.json();
        console.log(`📝 [UploadSuccess] Job status: jobId=${data.jobId}, status=${data.status}, progress=${data.progress}%`);
        
        if (!isActive) return;
        setJobStatus(data.status);

        // Step 2: If already complete, fetch full data and finish
        if (data.status === 'complete') {
          console.log(`✅ [UploadSuccess] Analysis already complete, fetching full data...`);
          const fullData = await fetchStatus();
          if (isActive && fullData) {
            handleComplete(fullData);
          }
          return;
        }

        // Step 3: Start elapsed time counter
        elapsedIntervalRef.current = window.setInterval(() => {
          if (!isActive) return;
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedTime(elapsed);
          
          if (elapsed * 1000 >= POLLING_CONFIG.maxDurationMs) {
            setShowRefreshLater(true);
          }
        }, 1000);

        // Step 4: Do immediate poll, then start interval
        await pollOnce();
        
        if (isActive) {
          pollingIntervalRef.current = window.setInterval(pollOnce, POLLING_CONFIG.intervalMs);
        }

      } catch (err) {
        if (!isActive) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        
        console.error(`❌ [UploadSuccess] Failed to start analysis:`, err);
        setError('Failed to start analysis. Please try again.');
        setErrorDetails(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    // Start!
    startPolling();

    // Cleanup
    return () => {
      isActive = false;
      abortController.abort();
      clearIntervals();
    };
  }, [resolvedIds]); // ONLY depends on resolvedIds - no callbacks!

  // ==========================================
  // HELPERS
  // ==========================================
  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusMessage = (): string => {
    if (error) return 'Error occurred';
    if (showRefreshLater) return 'Still processing...';
    switch (jobStatus) {
      case 'queued': return 'Waiting to start...';
      case 'processing': return `Analyzing: ${Math.floor(progress)}%`;
      case 'complete': return 'Analysis complete!';
      case 'error': return 'Error occurred';
      default: return 'Processing...';
    }
  };

  const getStepDescription = (): string => {
    switch (jobStatus) {
      case 'queued': return 'Your recording has been received. Preparing to analyze your speech...';
      case 'processing': return 'Analyzing your argument structure, delivery, and presentation...';
      case 'complete': return 'Your performance evaluation is ready!';
      default: return 'Processing your recording...';
    }
  };

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        <div style={styles.header}>
          <h1 style={styles.title}>Evaluating Your Performance</h1>
          <p style={styles.subtitle}>
            Analyzing your speech recording
          </p>
        </div>

        <div style={styles.mainContent}>
          <div style={styles.progressSection}>
            <p style={styles.progressText}>{getStatusMessage()}</p>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
            </div>
            {!error && !showRefreshLater && (
              <p style={styles.elapsedText}>Elapsed: {formatElapsed(elapsedTime)}</p>
            )}
          </div>

          {/* Refresh Later Notice */}
          {showRefreshLater && !error && (
            <div style={styles.refreshLaterBox}>
              <h3 style={styles.refreshLaterTitle}>Taking longer than expected</h3>
              <p style={styles.refreshLaterText}>
                Your analysis is still being processed. You can wait here, or come back later — 
                your results will be saved automatically.
              </p>
              <div style={styles.refreshLaterActions}>
                <button onClick={() => window.location.reload()} style={styles.secondaryButton}>
                  Refresh Page
                </button>
                <button onClick={() => { window.location.href = '/history'; }} style={styles.primaryButton}>
                  Check History Later
                </button>
              </div>
              <p style={styles.refreshLaterHint}>
                We're still processing in the background. Your ballot will appear in your history when ready.
              </p>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div style={styles.errorBox}>
              <p style={styles.errorText}>{error}</p>
              {errorDetails && (
                <details style={styles.errorDetails}>
                  <summary style={styles.errorDetailsSummary}>Technical details</summary>
                  <pre style={styles.errorDetailsPre}>{errorDetails}</pre>
                </details>
              )}
              <button onClick={() => window.location.reload()} style={styles.retryButton}>
                Restart
              </button>
            </div>
          )}

          {/* Status Indicator */}
          {!showRefreshLater && (
            <div style={styles.stepList}>
              <div style={styles.stepItem}>
                <div style={jobStatus === 'complete' ? styles.doneIcon : styles.spinner}>
                  {jobStatus === 'complete' ? '✓' : ''}
                </div>
                <div style={styles.stepContent}>
                  <h3 style={styles.stepTitle}>
                    {jobStatus === 'queued' ? 'Preparing Analysis' :
                     jobStatus === 'processing' ? 'Analyzing Speech' :
                     'Evaluation Complete'}
                  </h3>
                  <p style={styles.stepDesc}>{getStepDescription()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Context Box */}
          <div style={styles.contextBox}>
            <p style={styles.contextLabel}>Theme: <span style={styles.contextValue}>{theme}</span></p>
            <p style={styles.contextLabel}>Quote: <span style={styles.contextQuote}>"{quote}"</span></p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ==========================================
// STYLES
// ==========================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 64px)', // Account for navbar
    overflow: 'hidden',
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '1280px',
    margin: '0 auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { width: '100%', maxWidth: '900px' },
  header: { marginBottom: '48px', textAlign: 'center' },
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
  mainContent: { maxWidth: '720px', marginLeft: 'auto', marginRight: 'auto' },
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
  progressText: { color: '#111111', fontSize: '1rem', fontWeight: 500, margin: 0 },
  elapsedText: { color: '#6b7280', fontSize: '0.85rem', margin: 0 },
  stepList: { marginBottom: '48px' },
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
  stepContent: { flex: 1 },
  stepTitle: { margin: '0 0 4px 0', fontSize: '1.1rem', fontWeight: 600, color: '#111111' },
  stepDesc: { margin: 0, fontSize: '0.95rem', color: '#666666', lineHeight: 1.5 },
  errorBox: {
    padding: '20px',
    background: '#fff5f5',
    border: '1px solid #feb2b2',
    borderRadius: '12px',
    marginBottom: '32px',
  },
  errorText: { color: '#c53030', margin: '0 0 16px 0', fontSize: '0.95rem' },
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
  errorDetails: { margin: '12px 0 16px 0' },
  errorDetailsSummary: { cursor: 'pointer', color: '#111111', fontSize: '0.85rem', fontWeight: 600 },
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
  refreshLaterBox: {
    padding: '24px',
    background: '#fffbeb',
    border: '1px solid #fbbf24',
    borderRadius: '12px',
    marginBottom: '32px',
    textAlign: 'center',
  },
  refreshLaterTitle: { margin: '0 0 12px 0', fontSize: '1.1rem', fontWeight: 600, color: '#92400e' },
  refreshLaterText: { margin: '0 0 20px 0', fontSize: '0.95rem', color: '#78350f', lineHeight: 1.5 },
  refreshLaterActions: { display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' },
  primaryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondaryButton: {
    background: '#ffffff',
    color: '#000000',
    border: '1px solid #d4d4d4',
    padding: '10px 20px',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  refreshLaterHint: { margin: 0, fontSize: '0.85rem', color: '#a16207', fontStyle: 'italic' },
  contextBox: { padding: '24px', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px' },
  contextLabel: { color: '#6b7280', fontSize: '0.9rem', margin: '0 0 8px 0' },
  contextValue: { color: '#111111', fontWeight: 600 },
  contextQuote: { color: '#111111', fontStyle: 'italic' },
};

export default UploadSuccess;
