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
import { DebateAnalysis } from '../types';

// Helper to get color based on score
function getScoreColor(score: number): string {
  if (score >= 8) return '#059669'; // Excellent (green)
  if (score >= 6) return '#fbbf24'; // Good (amber/yellow)
  if (score >= 4) return '#f97316'; // Fair (orange)
  return '#dc2626'; // Poor (red)
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
  analysis: DebateAnalysis;
  theme: string;
  quote: string;
  transcript: string;
  videoFilename: string;
  isMock?: boolean;
  onRedoRound: () => void;    // Redo with same quote
  onNewRound: () => void;     // Start fresh with new theme
  onGoHome: () => void;       // Return to homepage
}

function FeedbackReport({
  analysis,
  theme,
  quote,
  transcript,
  videoFilename,
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
            // Competitive scores
            overallScore: analysis.overallScore,
            contentScore: analysis.categoryScores.content.score,
            deliveryScore: analysis.categoryScores.delivery.score,
            languageScore: analysis.categoryScores.language.score,
            bodyLanguageScore: analysis.categoryScores.bodyLanguage.score,
            // Stats
            duration: analysis.speechStats.duration,
            wordCount: analysis.speechStats.wordCount,
            wpm: analysis.speechStats.wpm,
            fillerWordCount: analysis.speechStats.fillerWordCount,
            // Feedback
            performanceTier: analysis.performanceTier,
            tournamentReady: analysis.tournamentReady,
            strengths: analysis.strengths,
            practiceDrill: analysis.practiceDrill,
            // Meta
            videoFilename,
            createdAt: sessionCreatedAt.current,
            // Store full analysis as JSON string for future-proofing
            fullAnalysisJson: JSON.stringify(analysis),
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
  }, [sessionId, analysis, theme, quote, transcript, videoFilename, isMock]);

  // Helper to render a score circle
  const renderScoreRing = (score: number, label: string, weight: string) => {
    const color = getScoreColor(score);
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 10) * circumference;

    return (
      <div style={styles.scoreCard}>
        <div style={styles.ringContainer}>
          <svg width="160" height="160" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="#f0f0f0"
              strokeWidth="10"
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
            <text
              x="50"
              y="55"
              textAnchor="middle"
              style={{ ...styles.ringScore, fill: color }}
            >
              {score.toFixed(1)}
            </text>
          </svg>
        </div>
        <div style={styles.scoreInfo}>
          <div style={styles.scoreLabelMain}>{label}</div>
          <div style={styles.scoreWeight}>{weight} weight</div>
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Top Navigation */}
      <button onClick={onGoHome} style={styles.backLink}>
        ← Back to Dashboard
      </button>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.tierBadge}>
            {analysis.performanceTier.toUpperCase()} TIER
          </div>
          <h1 style={styles.title}>Tournament Ballot</h1>
          <p style={styles.subtitle}>NSDA-Standard Impromptu Evaluation</p>
        </div>
        <div style={styles.overallScoreCard}>
          <div style={styles.overallScoreTop}>OVERALL SCORE</div>
          <div style={{ ...styles.overallScoreValue, color: getScoreColor(analysis.overallScore) }}>
            {analysis.overallScore.toFixed(1)}<span style={styles.overallMax}>/10.0</span>
          </div>
          <div style={styles.readinessRow}>
            Tournament Ready: <span style={{ fontWeight: 700, color: analysis.tournamentReady ? '#059669' : '#dc2626' }}>{analysis.tournamentReady ? 'YES' : 'NO'}</span>
          </div>
        </div>
      </div>

      {/* Score Rings Section */}
      <div style={styles.ringsGrid}>
        {renderScoreRing(analysis.categoryScores.content.score, 'Content', '40%')}
        {renderScoreRing(analysis.categoryScores.delivery.score, 'Delivery', '30%')}
        {renderScoreRing(analysis.categoryScores.language.score, 'Language', '15%')}
        {renderScoreRing(analysis.categoryScores.bodyLanguage.score, 'Body Language', '15%')}
      </div>

      {/* Stats Bar */}
      <div style={styles.statsBar}>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>DURATION</div>
          <div style={styles.statsBarValue}>{analysis.speechStats.duration}</div>
        </div>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>WORDS</div>
          <div style={styles.statsBarValue}>{analysis.speechStats.wordCount}</div>
        </div>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>PACE</div>
          <div style={styles.statsBarValue}>{analysis.speechStats.wpm} WPM</div>
        </div>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>FILLERS</div>
          <div style={styles.statsBarValue}>{analysis.speechStats.fillerWordCount} total</div>
        </div>
      </div>

      {/* Main Content Two Columns */}
      <div style={styles.contentGrid}>
        {/* Left Column */}
        <div style={styles.leftCol}>
          <div style={styles.analysisSectionWithBg}>
            <h2 style={styles.sectionHeader}>| Content Analysis (40%)</h2>
            
            <div style={styles.analysisItem}>
              <div style={styles.analysisHeader}>
                <span style={styles.analysisTitle}>Topic Adherence</span>
                <div style={styles.analysisScore}>
                  <div style={styles.progressBarBg}>
                    <div style={{ ...styles.progressBarFill, width: `${analysis.contentAnalysis.topicAdherence.score * 10}%` }} />
                  </div>
                  <span style={styles.scoreText}>{analysis.contentAnalysis.topicAdherence.score}/10</span>
                </div>
              </div>
              <p style={styles.analysisFeedback}>{analysis.contentAnalysis.topicAdherence.feedback}</p>
            </div>

            <div style={styles.analysisItem}>
              <div style={styles.analysisHeader}>
                <span style={styles.analysisTitle}>Argument Structure</span>
                <div style={styles.analysisScore}>
                  <div style={styles.progressBarBg}>
                    <div style={{ ...styles.progressBarFill, width: `${analysis.contentAnalysis.argumentStructure.score * 10}%` }} />
                  </div>
                  <span style={styles.scoreText}>{analysis.contentAnalysis.argumentStructure.score}/10</span>
                </div>
              </div>
              <p style={styles.analysisFeedback}>{analysis.contentAnalysis.argumentStructure.feedback}</p>
            </div>
          </div>

          <div style={styles.analysisSectionWithBg}>
            <h2 style={styles.sectionHeader}>| Delivery Analysis (30%)</h2>
            
            <div style={styles.analysisItem}>
              <div style={styles.analysisHeader}>
                <span style={styles.analysisTitle}>Vocal Variety</span>
                <span style={styles.scoreTextPlain}>{analysis.deliveryAnalysis.vocalVariety.score}/10</span>
              </div>
              <p style={styles.analysisFeedback}>{analysis.deliveryAnalysis.vocalVariety.feedback}</p>
            </div>

            <div style={styles.fillerBreakdown}>
              <div style={styles.fillerLabel}>Filler Word Breakdown</div>
              <div style={styles.fillerBadges}>
                {Object.entries(analysis.deliveryAnalysis.fillerWords.breakdown).length > 0 ? (
                  Object.entries(analysis.deliveryAnalysis.fillerWords.breakdown).map(([word, count]) => (
                    <div key={word} style={styles.fillerBadge}>
                      <span style={styles.fillerWord}>{word}</span>
                      <span style={styles.fillerCount}>{count}</span>
                    </div>
                  ))
                ) : (
                  <div style={styles.fillerBadge}>
                    <span style={styles.fillerWord}>Total</span>
                    <span style={styles.fillerCount}>0</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={styles.analysisSection}>
            <h2 style={styles.sectionHeader}>| Structural Breakdown</h2>
            <div style={styles.structureList}>
              <div style={styles.structureEntry}>
                <div style={styles.structureTime}>{analysis.structureAnalysis.introduction.timeRange}</div>
                <div style={styles.structureContent}>
                  <div style={styles.structureTitle}>Introduction</div>
                  <p style={styles.structureText}>{analysis.structureAnalysis.introduction.assessment}</p>
                </div>
              </div>
              {analysis.structureAnalysis.bodyPoints.map((point, idx) => (
                <div key={idx} style={styles.structureEntry}>
                  <div style={styles.structureTime}>{point.timeRange}</div>
                  <div style={styles.structureContent}>
                    <div style={styles.structureTitle}>Body Point {idx + 1}</div>
                    <p style={styles.structureText}>{point.assessment}</p>
                  </div>
                </div>
              ))}
              <div style={styles.structureEntry}>
                <div style={styles.structureTime}>{analysis.structureAnalysis.conclusion.timeRange}</div>
                <div style={styles.structureContent}>
                  <div style={styles.structureTitle}>Conclusion</div>
                  <p style={styles.structureText}>{analysis.structureAnalysis.conclusion.assessment}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div style={styles.rightCol}>
          <div style={styles.priorityBox}>
            <h3 style={styles.priorityBoxTitle}>Priority Improvements</h3>
            {analysis.priorityImprovements.map((imp) => (
              <div key={imp.priority} style={styles.priorityItem}>
                <div style={styles.priorityItemTitle}>#{imp.priority} {imp.issue}</div>
                <div style={styles.priorityDetail}>
                  <span style={styles.boldLabel}>Action:</span> {imp.action}
                </div>
                <div style={styles.priorityDetail}>
                  <span style={{ ...styles.boldLabel, color: '#dc2626' }}>Impact:</span> {imp.impact}
                </div>
              </div>
            ))}
          </div>

          <div style={styles.drillBox}>
            <h3 style={styles.drillBoxTitle}>Practice Drill</h3>
            <p style={styles.drillText}>{analysis.practiceDrill}</p>
            <div style={styles.nextFocus}>
              <span style={styles.nextFocusLabel}>Next Focus:</span> {analysis.nextSessionFocus.primary}
            </div>
          </div>

          <div style={styles.strengthsSection}>
            <h3 style={styles.sectionHeader}>| Strengths to Maintain</h3>
            <div style={styles.strengthsList}>
              {analysis.strengths.map((s, i) => (
                <div key={i} style={styles.strengthItem}>
                  <span style={styles.checkmark}>✓</span> {s}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Buttons */}
      <div style={styles.footerActions}>
        <button onClick={onRedoRound} style={styles.secondaryButton}>Redo Round</button>
        <button onClick={onNewRound} style={styles.primaryButton}>Start New Round</button>
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
    padding: '40px 48px 120px 48px',
    background: '#ffffff',
    color: '#000000',
    fontFamily: "'Segoe UI', Roboto, sans-serif",
    maxWidth: '1400px',
    margin: '0 auto',
  },
  backLink: {
    background: 'none',
    border: 'none',
    color: '#666666',
    fontSize: '0.9rem',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '32px',
    textAlign: 'left',
    width: 'fit-content',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '48px',
  },
  headerLeft: {
    flex: 1,
  },
  tierBadge: {
    background: '#000000',
    color: '#ffffff',
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 700,
    width: 'fit-content',
    marginBottom: '16px',
    letterSpacing: '0.05em',
  },
  title: {
    fontSize: '3rem',
    fontWeight: 800,
    margin: '0 0 8px 0',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '1.1rem',
    color: '#666666',
    margin: 0,
  },
  overallScoreCard: {
    background: '#ffffff',
    border: '1px solid #eeeeee',
    borderRadius: '12px',
    padding: '24px',
    textAlign: 'center',
    boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
    minWidth: '200px',
  },
  overallScoreTop: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#999999',
    letterSpacing: '0.1em',
    marginBottom: '8px',
  },
  overallScoreValue: {
    fontSize: '3.5rem',
    fontWeight: 800,
    lineHeight: 1,
    marginBottom: '8px',
  },
  overallMax: {
    fontSize: '1.2rem',
    color: '#cccccc',
    fontWeight: 400,
  },
  readinessRow: {
    fontSize: '0.85rem',
    fontWeight: 600,
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #eeeeee',
  },
  ringsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '24px',
    marginBottom: '48px',
    maxWidth: '1000px',
    margin: '0 auto 48px auto',
  },
  scoreCard: {
    background: '#ffffff',
    border: 'none',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  ringContainer: {
    marginBottom: '16px',
  },
  ringScore: {
    fontSize: '24px',
    fontWeight: 800,
    fontFamily: 'inherit',
  },
  scoreInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  scoreLabelMain: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#000000',
  },
  scoreWeight: {
    fontSize: '0.75rem',
    color: '#999999',
  },
  statsBar: {
    background: '#111111',
    borderRadius: '12px',
    padding: '24px 48px',
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: '64px',
    color: '#ffffff',
  },
  statsBarItem: {
    textAlign: 'center',
  },
  statsBarLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#888888',
    letterSpacing: '0.1em',
    marginBottom: '8px',
  },
  statsBarValue: {
    fontSize: '1.25rem',
    fontWeight: 700,
  },
  contentGrid: {
    display: 'flex',
    gap: '64px',
    alignItems: 'flex-start',
  },
  leftCol: {
    flex: 1.6,
    display: 'flex',
    flexDirection: 'column',
    gap: '64px',
  },
  analysisSection: {
    display: 'flex',
    flexDirection: 'column',
  },
  analysisSectionWithBg: {
    display: 'flex',
    flexDirection: 'column',
    background: '#fafafa',
    border: '1px solid #f0f0f0',
    borderRadius: '16px',
    padding: '32px',
    marginBottom: '32px',
  },
  sectionHeader: {
    fontSize: '1.25rem',
    fontWeight: 800,
    marginBottom: '32px',
    display: 'flex',
    alignItems: 'center',
  },
  analysisItem: {
    marginBottom: '32px',
  },
  analysisHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  analysisTitle: {
    fontSize: '1rem',
    fontWeight: 700,
  },
  analysisScore: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  progressBarBg: {
    width: '120px',
    height: '6px',
    background: '#f3f4f6',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: '#000000',
  },
  scoreText: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#666666',
    minWidth: '40px',
    textAlign: 'right',
  },
  scoreTextPlain: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#666666',
  },
  analysisFeedback: {
    fontSize: '0.95rem',
    lineHeight: 1.6,
    color: '#444444',
    margin: 0,
  },
  fillerBreakdown: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px dashed #eeeeee',
  },
  fillerLabel: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#999999',
    marginBottom: '12px',
  },
  fillerBadges: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  fillerBadge: {
    background: '#ffffff',
    border: '1px solid #eeeeee',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '0.85rem',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  fillerWord: {
    color: '#666666',
    fontStyle: 'italic',
  },
  fillerCount: {
    fontWeight: 700,
    color: '#000000',
  },
  structureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  structureEntry: {
    background: '#ffffff',
    border: '1px solid #eeeeee',
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    gap: '24px',
  },
  structureTime: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#999999',
    minWidth: '70px',
  },
  structureContent: {
    flex: 1,
  },
  structureTitle: {
    fontSize: '0.95rem',
    fontWeight: 700,
    marginBottom: '8px',
  },
  structureText: {
    fontSize: '0.9rem',
    lineHeight: 1.5,
    color: '#666666',
    margin: 0,
  },
  rightCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  priorityBox: {
    background: '#fff1f2',
    border: '1px solid #fecaca',
    borderRadius: '16px',
    padding: '32px',
  },
  priorityBoxTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#be123c',
    marginBottom: '24px',
  },
  priorityItem: {
    marginBottom: '24px',
    paddingBottom: '24px',
    borderBottom: '1px solid rgba(190, 18, 60, 0.1)',
  },
  priorityItemTitle: {
    fontSize: '1rem',
    fontWeight: 800,
    marginBottom: '12px',
  },
  priorityDetail: {
    fontSize: '0.9rem',
    lineHeight: 1.5,
    marginBottom: '8px',
  },
  boldLabel: {
    fontWeight: 700,
  },
  drillBox: {
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: '16px',
    padding: '32px',
  },
  drillBoxTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#0369a1',
    marginBottom: '16px',
  },
  drillText: {
    fontSize: '0.95rem',
    lineHeight: 1.6,
    color: '#0c4a6e',
    marginBottom: '24px',
  },
  nextFocus: {
    borderTop: '1px solid rgba(3, 105, 161, 0.1)',
    paddingTop: '16px',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#0369a1',
  },
  nextFocusLabel: {
    fontWeight: 800,
  },
  strengthsSection: {
    marginTop: '0',
  },
  strengthsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  strengthItem: {
    background: '#f0fdf4',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '0.95rem',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontWeight: 600,
    color: '#166534',
  },
  checkmark: {
    color: '#22c55e',
    fontWeight: 900,
  },
  footerActions: {
    marginTop: '80px',
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    paddingTop: '48px',
    borderTop: '1px solid #eeeeee',
  },
  primaryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '16px 40px',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    background: '#ffffff',
    color: '#000000',
    border: '2px solid #000000',
    padding: '14px 40px',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
  },
};

export default FeedbackReport;

