/**
 * FeedbackReport Component
 * 
 * Displays the comprehensive debate judge feedback from Gemini.
 * Shows:
 * - Overall score with visual indicator
 * - Content and delivery analysis
 * - Strengths and areas for improvement
 * - Specific actionable tips
 * - Summary with encouraging message
 * 
 * Automatically saves the session to InstantDB on mount.
 * 
 * Provides options to:
 * - Redo the same round (same quote)
 * - Start a new round (new theme/quotes)
 */

import { useEffect, useRef, useMemo } from 'react';
import { id } from '@instantdb/react';
import { db } from '../lib/instant';
import { DebateFeedback, SpeechStats } from '../types';

// Helper to get color based on score
function getScoreColor(score: number): string {
  if (score >= 8) return '#059669'; // green
  if (score >= 6) return '#d97706'; // amber
  return '#dc2626'; // red
}

// Format duration in minutes:seconds
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Generate a unique hash from session content to prevent duplicates
function generateSessionHash(theme: string, quote: string, transcript: string, createdAt: number): string {
  const content = `${theme}-${quote}-${transcript.substring(0, 100)}-${createdAt}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

interface FeedbackReportProps {
  feedback: DebateFeedback;
  theme: string;
  quote: string;
  transcript: string;
  bodyLanguageAnalysis: string;
  videoFilename: string;
  speechStats?: SpeechStats;
  isMock?: boolean;
  onRedoRound: () => void;    // Redo with same quote
  onNewRound: () => void;     // Start fresh with new theme
  onGoHome: () => void;       // Return to homepage
}

function FeedbackReport({
  feedback,
  theme,
  quote,
  transcript,
  bodyLanguageAnalysis,
  videoFilename,
  speechStats,
  isMock,
  onRedoRound,
  onNewRound,
  onGoHome,
}: FeedbackReportProps) {
  // Track if we've already saved this session
  const savedRef = useRef(false);
  
  // Generate a stable session ID based on content (prevents duplicates on re-render)
  const sessionCreatedAt = useRef(Date.now());
  const sessionId = useMemo(() => {
    return generateSessionHash(theme, quote, transcript, sessionCreatedAt.current);
  }, [theme, quote, transcript]);

  // Calculate average score for overall display
  const avgScore = Math.round(
    (feedback.scores.structure + feedback.scores.content + feedback.scores.delivery) / 3
  );

  // ===========================================
  // SAVE SESSION TO INSTANTDB
  // ===========================================

  useEffect(() => {
    // Only save once per feedback session using sessionId as key
    const saveKey = `saved_session_${sessionId}`;
    
    // Check if already saved (both in ref and sessionStorage for page refresh protection)
    if (savedRef.current || sessionStorage.getItem(saveKey)) {
      console.log('📝 Skipping save - already saved');
      return;
    }
    
    // Don't save mock data
    if (isMock) {
      console.log('📝 Skipping save - mock data');
      return;
    }

    // Save the session to InstantDB
    const saveSession = async () => {
      try {
        console.log('💾 Saving session to InstantDB...');
        
        db.transact(
          db.tx.sessions[id()].update({
            theme,
            quote,
            transcript,
            bodyLanguageAnalysis,
            // Speech stats
            durationSeconds: speechStats?.durationSeconds || 0,
            wordCount: speechStats?.wordCount || 0,
            wordsPerMinute: speechStats?.wordsPerMinute || 0,
            fillerCount: speechStats?.fillerCount || 0,
            // Scores
            structureScore: feedback.scores.structure,
            contentScore: feedback.scores.content,
            deliveryScore: feedback.scores.delivery,
            // Feedback content
            strengths: feedback.strengths,
            improvements: feedback.improvements,
            practiceDrill: feedback.practiceDrill,
            contentSummary: feedback.contentSummary || '',
            videoFilename,
            createdAt: sessionCreatedAt.current,
          })
        );

        savedRef.current = true;
        sessionStorage.setItem(saveKey, 'true');
        console.log('✅ Session saved to InstantDB');
      } catch (error) {
        console.error('❌ Failed to save session:', error);
      }
    };

    saveSession();
  }, [sessionId, feedback, theme, quote, transcript, bodyLanguageAnalysis, videoFilename, speechStats, isMock]);

  // Helper to render a score circle
  const renderScoreCircle = (score: number, label: string) => {
    const color = getScoreColor(score);
    return (
      <div style={styles.scoreItem}>
        <div style={styles.scoreCircle}>
          <svg viewBox="0 0 100 100" style={styles.scoreSvg}>
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="#e5e5e5"
              strokeWidth="6"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${score * 28.3} 283`}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dasharray 1s ease' }}
            />
          </svg>
          <div style={styles.scoreValue}>
            <span style={{ ...styles.scoreNumber, color }}>
              {score}
            </span>
            <span style={styles.scoreMax}>/10</span>
          </div>
        </div>
        <p style={styles.scoreLabel}>{label}</p>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Your Impromptu Feedback</h1>
        <p style={styles.subtitle}>Evaluated by AI Impromptu Judge</p>
        {isMock && (
          <span style={styles.mockBadge}>Demo Mode - Configure DEEPSEEK_API_KEY for real feedback</span>
        )}
      </div>

      {/* Main content */}
      <div style={styles.mainContent}>
        {/* Context: Theme and Quote */}
        <div style={styles.contextBox}>
          <div style={styles.contextItem}>
            <span style={styles.contextLabel}>Theme:</span>
            <span style={styles.contextValue}>{theme}</span>
          </div>
          <div style={styles.contextItem}>
            <span style={styles.contextLabel}>Quote:</span>
            <span style={styles.contextValueQuote}>"{quote}"</span>
          </div>
        </div>

        {/* Three Score Circles */}
        <div style={styles.scoresContainer}>
          {renderScoreCircle(feedback.scores.structure, 'Structure')}
          {renderScoreCircle(feedback.scores.content, 'Content')}
          {renderScoreCircle(feedback.scores.delivery, 'Delivery')}
        </div>

        {/* Average Score Indicator */}
        <div style={styles.avgScoreBox}>
          <span style={styles.avgScoreLabel}>Average Score:</span>
          <span style={{ ...styles.avgScoreValue, color: getScoreColor(avgScore) }}>
            {avgScore}/10
          </span>
        </div>

        {/* Speech Stats */}
        {speechStats && (
          <div style={styles.statsGrid}>
            <div style={styles.statBox}>
              <span style={styles.statIcon}>⏱️</span>
              <span style={styles.statValue}>{formatDuration(speechStats.durationSeconds)}</span>
              <span style={styles.statLabel}>Duration</span>
            </div>
            <div style={styles.statBox}>
              <span style={styles.statIcon}>📝</span>
              <span style={styles.statValue}>{speechStats.wordCount}</span>
              <span style={styles.statLabel}>Words</span>
            </div>
            <div style={styles.statBox}>
              <span style={styles.statIcon}>🎯</span>
              <span style={styles.statValue}>{speechStats.wordsPerMinute}</span>
              <span style={styles.statLabel}>WPM</span>
            </div>
            <div style={styles.statBox}>
              <span style={styles.statIcon}>💬</span>
              <span style={styles.statValue}>{speechStats.fillerCount}</span>
              <span style={styles.statLabel}>Fillers</span>
            </div>
          </div>
        )}

        {/* Content Summary */}
        {feedback.contentSummary && (
          <div style={styles.summaryBox}>
            <h3 style={styles.summaryTitle}>📄 Content Summary</h3>
            <p style={styles.summaryText}>{feedback.contentSummary}</p>
          </div>
        )}

        {/* Strengths */}
        <div style={styles.listSection}>
          <h3 style={styles.listTitle}>✓ Strengths</h3>
          <ul style={styles.list}>
            {feedback.strengths.map((strength, index) => (
              <li key={index} style={styles.listItemStrength}>
                {strength}
              </li>
            ))}
          </ul>
        </div>

        {/* Areas for Improvement */}
        <div style={styles.listSection}>
          <h3 style={styles.listTitle}>↑ Areas to Improve</h3>
          <ul style={styles.list}>
            {feedback.improvements.map((improvement, index) => (
              <li key={index} style={styles.listItemImprove}>
                {improvement}
              </li>
            ))}
          </ul>
        </div>

        {/* Practice Drill */}
        <div style={styles.drillBox}>
          <h3 style={styles.drillTitle}>🎯 Practice Drill</h3>
          <p style={styles.drillText}>{feedback.practiceDrill}</p>
        </div>

        {/* Action Buttons */}
        <div style={styles.buttonContainer}>
          <button onClick={onGoHome} style={styles.homeButton}>
            Return to Homepage
          </button>
          <button onClick={onRedoRound} style={styles.redoButton}>
            Redo This Round
          </button>
          <button onClick={onNewRound} style={styles.newButton}>
            Start New Round
          </button>
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
    fontSize: '2.5rem',
    margin: '0 0 12px 0',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#666666',
    fontSize: '1.1rem',
    margin: 0,
  },
  mockBadge: {
    display: 'inline-block',
    marginTop: '16px',
    background: '#fffbeb',
    color: '#d97706',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '0.85rem',
    border: '1px solid #fbbf24',
  },
  mainContent: {
    maxWidth: '900px',
  },
  contextBox: {
    background: '#fafafa',
    border: '1px solid #000000',
    borderRadius: '8px',
    padding: '20px 24px',
    marginBottom: '40px',
  },
  contextItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '8px',
  },
  contextLabel: {
    color: '#666666',
    fontSize: '0.95rem',
    minWidth: '60px',
  },
  contextValue: {
    color: '#111111',
    fontSize: '0.95rem',
    fontWeight: 500,
  },
  contextValueQuote: {
    color: '#333333',
    fontSize: '0.95rem',
    fontStyle: 'italic',
  },
  scoresContainer: {
    display: 'flex',
    justifyContent: 'flex-start',
    gap: '48px',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  scoreItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  scoreCircle: {
    position: 'relative',
    width: '120px',
    height: '120px',
  },
  scoreSvg: {
    width: '100%',
    height: '100%',
  },
  scoreValue: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
  },
  scoreNumber: {
    fontSize: '2rem',
    fontWeight: 700,
  },
  scoreMax: {
    color: '#666666',
    fontSize: '0.85rem',
  },
  scoreLabel: {
    color: '#333333',
    fontSize: '0.9rem',
    fontWeight: 500,
    marginTop: '8px',
    textAlign: 'center',
  },
  avgScoreBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '40px',
    padding: '12px 20px',
    background: '#fafafa',
    borderRadius: '8px',
    width: 'fit-content',
  },
  avgScoreLabel: {
    color: '#666666',
    fontSize: '0.95rem',
  },
  avgScoreValue: {
    fontSize: '1.25rem',
    fontWeight: 700,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
    marginBottom: '32px',
  },
  statBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px',
    background: '#fafafa',
    borderRadius: '8px',
    border: '1px solid #e5e5e5',
  },
  statIcon: {
    fontSize: '1.5rem',
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#111111',
  },
  statLabel: {
    fontSize: '0.8rem',
    color: '#666666',
    marginTop: '4px',
  },
  summaryBox: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '32px',
  },
  summaryTitle: {
    color: '#334155',
    fontSize: '1rem',
    fontWeight: 600,
    margin: '0 0 12px 0',
  },
  summaryText: {
    color: '#475569',
    fontSize: '0.95rem',
    lineHeight: 1.7,
    margin: 0,
  },
  listSection: {
    marginBottom: '32px',
  },
  listTitle: {
    color: '#111111',
    fontSize: '1.1rem',
    fontWeight: 600,
    margin: '0 0 16px 0',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  listItemStrength: {
    color: '#333333',
    fontSize: '0.95rem',
    lineHeight: 1.6,
    padding: '12px 16px',
    marginBottom: '8px',
    background: '#ecfdf5',
    borderLeft: '4px solid #059669',
    borderRadius: '0 8px 8px 0',
  },
  listItemImprove: {
    color: '#333333',
    fontSize: '0.95rem',
    lineHeight: 1.6,
    padding: '12px 16px',
    marginBottom: '8px',
    background: '#fffbeb',
    borderLeft: '4px solid #d97706',
    borderRadius: '0 8px 8px 0',
  },
  drillBox: {
    background: '#f0f9ff',
    border: '2px solid #0284c7',
    borderRadius: '8px',
    padding: '28px',
    marginBottom: '40px',
  },
  drillTitle: {
    color: '#0369a1',
    fontSize: '1.1rem',
    fontWeight: 600,
    margin: '0 0 16px 0',
  },
  drillText: {
    color: '#333333',
    fontSize: '1rem',
    lineHeight: 1.7,
    margin: 0,
  },
  buttonContainer: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  homeButton: {
    background: '#f3f4f6',
    color: '#374151',
    border: '2px solid #d1d5db',
    padding: '16px 32px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  redoButton: {
    background: '#ffffff',
    color: '#333333',
    border: '2px solid #000000',
    padding: '16px 32px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  newButton: {
    background: '#000000',
    color: '#ffffff',
    border: '2px solid #000000',
    padding: '16px 32px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

export default FeedbackReport;

