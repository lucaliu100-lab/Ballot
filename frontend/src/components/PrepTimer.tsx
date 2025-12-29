/**
 * PrepTimer Component
 * 
 * Shows a countdown timer (default 2 minutes) for the user to prepare.
 * Displays the selected quote and allows skipping to recording early.
 */

import { useState, useEffect } from 'react';

// Props that this component receives from its parent
interface PrepTimerProps {
  selectedQuote: string;                          // The quote the user selected
  durationSeconds?: number;                       // Timer duration (default: 120 = 2 minutes)
  onTimerComplete: (remainingTime: number) => void;  // Called when timer finishes or user skips
}

function PrepTimer({ 
  selectedQuote, 
  durationSeconds = 120, 
  onTimerComplete 
}: PrepTimerProps) {
  // Track remaining time in seconds
  const [timeLeft, setTimeLeft] = useState(durationSeconds);

  // Format seconds into MM:SS display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    // Pad with leading zeros: "1:05" instead of "1:5"
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage for the visual progress ring
  const progress = ((durationSeconds - timeLeft) / durationSeconds) * 100;

  // Set up the countdown timer
  useEffect(() => {
    // If timer reaches 0, move to next screen with 0 remaining
    if (timeLeft <= 0) {
      onTimerComplete(0);
      return;
    }

    // Decrease time by 1 second every 1000ms
    const timerId = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    // Cleanup: clear interval when component unmounts or timeLeft changes
    return () => clearInterval(timerId);
  }, [timeLeft, onTimerComplete]);

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.kicker}>PREPARATION</div>
          <h2 style={styles.title}>Preparation Time</h2>
          <p style={styles.subtitle}>Use these two minutes to structure your speech before recording.</p>
        </div>
        
        {/* Selected Quote */}
        <div style={styles.quoteBox}>
          <div style={styles.quoteLabel}>Your selected quote</div>
          <div style={styles.quote}>"{selectedQuote}"</div>
        </div>

        {/* Main content area */}
        <div style={styles.mainContent}>
          {/* Circular timer display */}
          <div style={styles.timerContainer}>
            <svg style={styles.progressRing} viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="6"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="#111827"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${progress * 2.83} 283`}
                transform="rotate(-90 50 50)"
                style={{ transition: 'stroke-dasharray 1s ease' }}
              />
            </svg>
            <div style={styles.timerText}>{formatTime(timeLeft)}</div>
          </div>

          {/* Tips */}
          <div style={styles.tips}>
            <div style={styles.tipsTitle}>Preparation tips</div>
            <ul style={styles.tipsList}>
              <li>Define what the quote means in one sentence</li>
              <li>Pick a personal example + a universal example</li>
              <li>Structure: Thesis → 2 points → closing takeaway</li>
            </ul>
          </div>
        </div>

        {/* CTA */}
        <div style={styles.actions}>
          <button
            onClick={() => onTimerComplete(timeLeft)}
            style={styles.primaryButton}
          >
            Skip & Start Recording
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles for this component
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '1280px',
    margin: '0 auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: '900px',
    paddingTop: '72px',
    paddingBottom: '120px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  kicker: {
    fontSize: '12px',
    color: '#6b7280',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: '8px',
  },
  title: {
    color: '#111827',
    fontSize: '36px',
    margin: '0 0 8px 0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '16px',
    margin: 0,
    maxWidth: '640px',
    lineHeight: 1.6,
  },
  quoteBox: {
    width: '100%',
    maxWidth: '800px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px 24px',
    marginBottom: '40px',
    boxSizing: 'border-box',
  },
  quoteLabel: {
    color: '#6b7280',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '10px',
  },
  quote: {
    color: '#111827',
    fontSize: '16px',
    margin: 0,
    fontStyle: 'italic',
    lineHeight: 1.6,
  },
  mainContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '48px',
    width: '100%',
    flexWrap: 'wrap',
  },
  timerContainer: {
    position: 'relative',
    width: '260px',
    height: '260px',
    flexShrink: 0,
  },
  progressRing: {
    width: '100%',
    height: '100%',
  },
  timerText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '3.25rem',
    fontWeight: 800,
    color: '#111827',
    fontFamily: 'monospace',
  },
  tips: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px 24px',
    maxWidth: '420px',
    boxSizing: 'border-box',
  },
  tipsTitle: {
    color: '#111827',
    fontSize: '14px',
    margin: '0 0 12px 0',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  tipsList: {
    color: '#374151',
    fontSize: '14px',
    margin: 0,
    paddingLeft: '20px',
    lineHeight: 1.9,
  },
  actions: {
    marginTop: '48px',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
  },
  primaryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '16px 36px',
    fontSize: '16px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 700,
    transition: 'background-color 200ms ease, transform 200ms ease, box-shadow 200ms ease',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  },
};

export default PrepTimer;




