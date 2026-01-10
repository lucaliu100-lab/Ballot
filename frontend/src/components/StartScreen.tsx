/**
 * StartScreen Component
 * 
 * The initial screen that shows a button to start a new practice round.
 * Clean, focused design with big title and collapsible instructions.
 */

import { useState } from 'react';
import { RoundData } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Props that this component receives from its parent
interface StartScreenProps {
  onRoundStart: (data: RoundData) => void;  // Called when round data is loaded
  onShowHistory: () => void; // Called to navigate to history
}

function StartScreen({ onRoundStart }: StartScreenProps) {
  // Track loading state while fetching from API
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCtaHover, setIsCtaHover] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  
  // Instructions visibility state
  const [showInstructions, setShowInstructions] = useState(false);

  // Handle the "Start" button click
  const handleStartRound = async () => {
    setLoading(true);
    setError(null);
    const currentRetry = retryCount;
    setRetryCount(currentRetry + 1);

    try {
      console.log('🎬 Start Round: requesting /api/start-round...');

      const controller = new AbortController();
      // Timeout for cold starts: 75 seconds
      const timeoutId = window.setTimeout(() => controller.abort(), 75_000);

      const response = await fetch(API_ENDPOINTS.startRound, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let details = '';
        try {
          if (contentType.includes('application/json')) {
            const json = await response.json();
            details = json?.error ? String(json.error) : JSON.stringify(json);
          } else {
            details = await response.text();
          }
        } catch { }
        const suffix = details ? `: ${details}` : '';
        throw new Error(`Failed to start round (${response.status})${suffix}`);
      }

      const data: RoundData = await response.json();
      setRetryCount(0); // Reset on success
      onRoundStart(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError(
          currentRetry === 0
            ? 'Server is waking up. Please click "Start" again and wait.'
            : `Still waking up (attempt ${currentRetry + 1}). Click "Start" again and wait.`
        );
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header Section - Big Title in Two Lines */}
        <div style={styles.header}>
          <h1 style={styles.mainTitle}>
            <span style={styles.titleLine}>Impromptu</span>
            <span style={styles.titleLine}>Speaking</span>
          </h1>
        </div>

        {/* Action Section - Start Button */}
        <div style={styles.actionSection}>
          <button
            onClick={handleStartRound}
            disabled={loading}
            onMouseEnter={() => setIsCtaHover(true)}
            onMouseLeave={() => setIsCtaHover(false)}
            style={{
              ...styles.ctaButton,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
              background: isCtaHover && !loading ? '#111111' : '#000000',
              transform: isCtaHover && !loading ? 'translateY(-2px)' : 'translateY(0)',
              boxShadow: isCtaHover && !loading
                ? '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
                : '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            }}
          >
            {loading ? 'Starting...' : 'Start'}
          </button>
          {error && <div style={styles.error}>{error}</div>}
        </div>

        {/* Collapsible Instructions */}
        <div style={styles.instructionsToggle}>
          <button
            onClick={() => setShowInstructions(!showInstructions)}
            style={styles.instructionsToggleButton}
          >
            <span>Instructions</span>
            <span style={{
              ...styles.arrow,
              transform: showInstructions ? 'rotate(180deg)' : 'rotate(0deg)',
            }}>↓</span>
          </button>
        </div>

        {/* Instructions Content - Shown when expanded */}
        {showInstructions && (
          <div style={styles.instructionsSection}>
            <div style={styles.stepsRow}>
              <div style={styles.stepItem}>
                <div style={styles.stepCircle}>1</div>
                <div style={styles.stepText}>Get Theme</div>
              </div>
              <div style={styles.stepArrow}>→</div>
              <div style={styles.stepItem}>
                <div style={styles.stepCircle}>2</div>
                <div style={styles.stepText}>Select Quote</div>
              </div>
              <div style={styles.stepArrow}>→</div>
              <div style={styles.stepItem}>
                <div style={styles.stepCircle}>3</div>
                <div style={styles.stepText}>Prep (2m)</div>
              </div>
              <div style={styles.stepArrow}>→</div>
              <div style={styles.stepItem}>
                <div style={styles.stepCircle}>4</div>
                <div style={styles.stepText}>Speak (5-7m)</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 64px)', // Account for navbar
    overflow: 'hidden',
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '900px',
    margin: '0 auto',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  inner: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginTop: '-32px', // Shift up to feel centered with navbar
  },
  
  // Header - Big Title
  header: {
    width: '100%',
    textAlign: 'center',
    marginBottom: '48px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  mainTitle: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: 0,
  },
  titleLine: {
    fontSize: '72px',
    fontWeight: 800,
    color: '#111827',
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    display: 'block',
  },

  // Action (Start Button)
  actionSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '32px',
    width: '100%',
  },
  ctaButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    borderRadius: '20px',
    padding: '36px 140px',
    fontSize: '26px',
    fontWeight: 700,
    letterSpacing: '0.02em',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    textTransform: 'uppercase',
  },
  error: {
    marginTop: '16px',
    color: '#dc2626',
    fontSize: '14px',
    background: '#fef2f2',
    padding: '8px 16px',
    borderRadius: '8px',
  },

  // Collapsible Instructions Toggle
  instructionsToggle: {
    marginBottom: '16px',
  },
  instructionsToggleButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
    color: '#6b7280',
    padding: '12px 20px',
    transition: 'color 0.2s ease',
  },
  arrow: {
    display: 'inline-block',
    transition: 'transform 0.3s ease',
    fontSize: '14px',
  },

  // Instructions Content
  instructionsSection: {
    width: '100%',
    maxWidth: '700px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px 32px',
    boxSizing: 'border-box',
    animation: 'fadeIn 0.3s ease',
  },
  stepsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  },
  stepItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  stepCircle: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: '#f3f4f6',
    color: '#4b5563',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 700,
  },
  stepText: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    textAlign: 'center',
  },
  stepArrow: {
    color: '#d1d5db',
    fontSize: '18px',
  },
};

export default StartScreen;
