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
      {/* Header */}
      <h2 style={styles.title}>Preparation Time</h2>
      
      {/* Show the selected quote */}
      <div style={styles.quoteBox}>
        <p style={styles.quoteLabel}>Your selected quote:</p>
        <p style={styles.quote}>"{selectedQuote}"</p>
      </div>

      {/* Main content area */}
      <div style={styles.mainContent}>
        {/* Circular timer display */}
        <div style={styles.timerContainer}>
          {/* SVG circle for progress visualization */}
          <svg style={styles.progressRing} viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="#e5e5e5"
              strokeWidth="6"
            />
            {/* Progress circle - dasharray creates the fill effect */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="#000000"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${progress * 2.83} 283`}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dasharray 1s ease' }}
            />
          </svg>
          {/* Time display in center of circle */}
          <div style={styles.timerText}>{formatTime(timeLeft)}</div>
        </div>

        {/* Tips for preparation */}
        <div style={styles.tips}>
          <p style={styles.tipsTitle}>Preparation tips:</p>
          <ul style={styles.tipsList}>
            <li>Think about what the quote means to you</li>
            <li>Consider a personal story that relates</li>
            <li>Structure: Opening, Main point, Conclusion</li>
          </ul>
        </div>
      </div>

      {/* Skip button to start recording early - passes remaining time */}
      <button
        onClick={() => onTimerComplete(timeLeft)}
        style={styles.skipButton}
      >
        Skip & Start Recording
      </button>
    </div>
  );
}

// Styles for this component
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '80px 48px 120px 48px',
    background: '#ffffff',
  },
  title: {
    color: '#111111',
    fontSize: '2rem',
    margin: '0 0 32px 0',
    fontWeight: 700,
  },
  quoteBox: {
    background: '#fafafa',
    border: '1px solid #000000',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '48px',
    maxWidth: '600px',
  },
  quoteLabel: {
    color: '#666666',
    fontSize: '0.9rem',
    margin: '0 0 8px 0',
  },
  quote: {
    color: '#111111',
    fontSize: '1.2rem',
    margin: 0,
    fontStyle: 'italic',
    lineHeight: 1.6,
  },
  mainContent: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '64px',
    flex: 1,
  },
  timerContainer: {
    position: 'relative',
    width: '200px',
    height: '200px',
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
    fontSize: '2.5rem',
    fontWeight: 700,
    color: '#111111',
    fontFamily: 'monospace',
  },
  tips: {
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '400px',
  },
  tipsTitle: {
    color: '#111111',
    fontSize: '1rem',
    margin: '0 0 16px 0',
    fontWeight: 600,
  },
  tipsList: {
    color: '#333333',
    fontSize: '0.95rem',
    margin: 0,
    paddingLeft: '20px',
    lineHeight: 1.8,
  },
  skipButton: {
    background: '#ffffff',
    color: '#333333',
    border: '2px solid #000000',
    padding: '14px 28px',
    fontSize: '1rem',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    alignSelf: 'flex-start',
    marginTop: '32px',
  },
};

export default PrepTimer;




