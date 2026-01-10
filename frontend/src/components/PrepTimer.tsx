/**
 * PrepTimer Component
 * 
 * Shows a countdown timer for the user to prepare.
 * Timer does NOT start immediately - user must click Start button.
 * Displays the selected quote and allows switching speech formats.
 */

import { useState, useEffect } from 'react';
import { SpeechFormat, SPEECH_FORMATS } from '../types';

// Props that this component receives from its parent
interface PrepTimerProps {
  selectedQuote: string;                          // The quote the user selected
  speechFormat: SpeechFormat;                     // Current speech format
  onTimerComplete: (remainingTime: number) => void;  // Called when timer finishes or user skips
  onFormatChange: (format: SpeechFormat) => void;    // Called when format changes
}

function PrepTimer({ 
  selectedQuote, 
  speechFormat,
  onTimerComplete,
  onFormatChange,
}: PrepTimerProps) {
  // Get the current format's duration (use this as source of truth)
  const currentDuration = SPEECH_FORMATS[speechFormat].prepDuration;
  
  // Track remaining time in seconds - initialize to current format duration
  const [timeLeft, setTimeLeft] = useState(currentDuration);
  
  // Track whether timer has started
  const [timerStarted, setTimerStarted] = useState(false);
  
  // Track elapsed time (used for format switching)
  const elapsedTime = currentDuration - timeLeft;

  // Handle format switch - keep elapsed time constant
  const handleFormatSwitch = (format: SpeechFormat) => {
    const newDuration = SPEECH_FORMATS[format].prepDuration;
    // Keep elapsed time the same, calculate new remaining time
    const newTimeLeft = Math.max(0, newDuration - elapsedTime);
    setTimeLeft(newTimeLeft);
    onFormatChange(format);
  };

  // Handle start button click
  const handleStart = () => {
    setTimerStarted(true);
  };

  // Format seconds into MM:SS display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage for the visual progress ring (use current format duration)
  const progress = timerStarted ? ((currentDuration - timeLeft) / currentDuration) * 100 : 0;

  // Set up the countdown timer - only runs when timer is started
  useEffect(() => {
    if (!timerStarted) return;
    
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
  }, [timeLeft, onTimerComplete, timerStarted]);

  // Reset timeLeft when format changes (before timer starts)
  useEffect(() => {
    if (!timerStarted) {
      setTimeLeft(currentDuration);
    }
  }, [currentDuration, timerStarted]);

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Preparation Time</h2>
        </div>
        
        {/* Main Content Box */}
        <div style={styles.mainBox}>
          {/* Left Side - Timer */}
          <div style={styles.timerSide}>
            <div style={styles.timerContainer}>
              <svg style={styles.progressRing} viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth="5"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#111827"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${progress * 2.83} 283`}
                  transform="rotate(-90 50 50)"
                  style={{ transition: 'stroke-dasharray 1s ease' }}
                />
              </svg>
              <div style={styles.timerText}>{formatTime(timeLeft)}</div>
            </div>
          </div>

          {/* Right Side - Quote, Format Selection, Start */}
          <div style={styles.controlsSide}>
            {/* Quote Display */}
            <div style={styles.quoteSection}>
              <div style={styles.quoteLabel}>Quote:</div>
              <div style={styles.quoteText}>"{selectedQuote}"</div>
            </div>

            {/* Format Selection */}
            <div style={styles.formatSection}>
              <div style={styles.formatLabel}>Select Level:</div>
              <div style={styles.formatButtons}>
                <button
                  onClick={() => handleFormatSwitch('middle-school')}
                  disabled={timerStarted}
                  style={{
                    ...styles.formatButton,
                    ...(speechFormat === 'middle-school' ? styles.formatButtonActive : {}),
                    opacity: timerStarted ? 0.6 : 1,
                    cursor: timerStarted ? 'not-allowed' : 'pointer',
                  }}
                >
                  Middle School Impromptu
                  <span style={styles.formatDuration}>3min prep, 4min speak</span>
                </button>
                <button
                  onClick={() => handleFormatSwitch('high-school')}
                  disabled={timerStarted}
                  style={{
                    ...styles.formatButton,
                    ...(speechFormat === 'high-school' ? styles.formatButtonActive : {}),
                    opacity: timerStarted ? 0.6 : 1,
                    cursor: timerStarted ? 'not-allowed' : 'pointer',
                  }}
                >
                  High School Impromptu
                  <span style={styles.formatDuration}>2min prep, 5min speak</span>
                </button>
              </div>
            </div>

            {/* Start Button - Only shown before timer starts */}
            {!timerStarted && (
              <button onClick={handleStart} style={styles.startButton}>
                Start
              </button>
            )}
          </div>
        </div>

        {/* CTA - Only shown after timer starts */}
        {timerStarted && (
          <div style={styles.actions}>
            <button
              onClick={() => onTimerComplete(timeLeft)}
              style={styles.primaryButton}
            >
              End Prep & Start Recording
            </button>
          </div>
        )}
      </div>

      {/* Step Indicator at Bottom */}
      <div style={styles.stepIndicator}>
        STEP 3 OF 4
      </div>
    </div>
  );
}

// Styles for this component
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
    position: 'relative',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: '900px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: '60px',
    marginTop: '-32px', // Shift up to feel centered with navbar
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  title: {
    color: '#111827',
    fontSize: '48px',
    margin: '0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  
  // Main Box - Split Layout
  mainBox: {
    display: 'flex',
    width: '100%',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    overflow: 'hidden',
  },
  
  // Left Side - Timer (larger)
  timerSide: {
    flex: '0 0 320px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    borderRight: '1px solid #e5e7eb',
    background: '#fafafa',
  },
  timerContainer: {
    position: 'relative',
    width: '240px',
    height: '240px',
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
    fontSize: '3rem',
    fontWeight: 800,
    color: '#111827',
    fontFamily: 'monospace',
  },
  
  // Right Side - Controls
  controlsSide: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '32px',
    gap: '20px',
  },
  
  // Quote Section
  quoteSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  quoteLabel: {
    color: '#6b7280',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  quoteText: {
    color: '#111827',
    fontSize: '15px',
    fontStyle: 'italic',
    lineHeight: 1.6,
  },
  
  // Format Selection
  formatSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  formatLabel: {
    color: '#6b7280',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  formatButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  formatButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '10px 14px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
    textAlign: 'left',
    transition: 'all 0.2s ease',
  },
  formatButtonActive: {
    background: '#f3f4f6',
    borderColor: '#111827',
  },
  formatDuration: {
    fontSize: '11px',
    fontWeight: 400,
    color: '#9ca3af',
  },
  
  // Start Button
  startButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '14px 28px',
    fontSize: '16px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 700,
    transition: 'background-color 200ms ease, transform 200ms ease',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    alignSelf: 'flex-start',
    marginTop: '4px',
  },
  
  // Actions (after timer starts)
  actions: {
    marginTop: '32px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
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
    width: '340px',
    textAlign: 'center',
  },
  stepIndicator: {
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '12px',
    fontWeight: 700,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

export default PrepTimer;
