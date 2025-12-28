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

import { useEffect, useRef, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
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
  backLabel?: string;         // Optional custom label for back button
  readOnly?: boolean;         // If true, do not save to database (for viewing history)
}

// Helper to parse the technical feedback string into structured parts
function parseFeedback(text: string) {
  const sections = {
    justification: "",
    evidence: [] as string[],
    meaning: "",
    improvement: [] as string[]
  };

  if (!text) return sections;

  // Extract Score Justification
  const justificationMatch = text.match(/\*\*Score Justification:\*\*([\s\S]*?)(?=\*\*|$)/i);
  if (justificationMatch) sections.justification = justificationMatch[1].trim();

  // Extract What This Means
  const meaningMatch = text.match(/\*\*What This Means:\*\*([\s\S]*?)(?=\*\*|$)/i);
  if (meaningMatch) sections.meaning = meaningMatch[1].trim();

  // Extract Evidence bullet points
  const evidenceLines = text.match(/\*\*Evidence from Speech:\*\*([\s\S]*?)(?=\*\*|$)/i);
  if (evidenceLines) {
    sections.evidence = evidenceLines[1]
      .split("\n")
      .map(l => l.replace(/^[-*]\s*/, "").trim())
      .filter(l => l.length > 0);
  }

  // Extract How to Improve bullet points
  const improvementLines = text.match(/\*\*How to Improve:\*\*([\s\S]*?)(?=\*\*|$)/i);
  if (improvementLines) {
    sections.improvement = improvementLines[1]
      .split("\n")
      .map(l => l.replace(/^\d+\.\s*/, "").trim())
      .filter(l => l.length > 0);
  }

  // If no sections found, treat whole text as justification
  if (!sections.justification && !sections.evidence.length && !sections.meaning && !sections.improvement.length) {
    sections.justification = text.replace(/\*\*/g, '').trim();
  }

  return sections;
}

interface AnalysisItemProps {
  title: string;
  score: number;
  feedback: string;
  showProgress?: boolean;
  customMetric?: string;
}

const AnalysisItem = ({ title, score, feedback, showProgress = true, customMetric }: AnalysisItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const parsed = parseFeedback(feedback);
  
  return (
    <div style={styles.analysisItem}>
      <div style={styles.analysisHeader}>
        <div style={styles.analysisTitleGroup}>
          <span style={styles.analysisTitle}>{title}</span>
          <span style={styles.scoreBadge}>{score.toFixed(1)}</span>
          {customMetric && <span style={styles.customMetricBadge}>{customMetric}</span>}
        </div>
        <div style={styles.analysisScore}>
          {showProgress && (
            <div style={styles.progressBarBg}>
              <div style={{ ...styles.progressBarFill, width: `${score * 10}%`, background: getScoreColor(score) }} />
            </div>
          )}
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            style={styles.expandButton}
          >
            {isExpanded ? 'Hide Details ↑' : 'Deep Dive ↓'}
          </button>
        </div>
      </div>

      <div style={styles.feedbackContainerCompact}>
        {parsed.justification && (
          <p style={styles.justificationText}>{parsed.justification}</p>
        )}
        
        {isExpanded && (
          <div style={styles.expandedContent}>
            <div style={styles.divider} />
            
            {parsed.evidence.length > 0 && (
              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>EVIDENCE FROM SPEECH</div>
                <ul style={styles.evidenceList}>
                  {parsed.evidence.map((item, i) => (
                    <li key={i} style={styles.evidenceItem}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.meaning && (
              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>JUDGE'S RATIONALE</div>
                <p style={styles.meaningText}>{parsed.meaning}</p>
              </div>
            )}

            {parsed.improvement.length > 0 && (
              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>CHAMPIONSHIP DRILLS</div>
                <div style={styles.improvementGrid}>
                  {parsed.improvement.map((item, i) => (
                    <div key={i} style={styles.improvementCard}>
                      <div style={styles.improvementNumber}>{i + 1}</div>
                      <div style={styles.improvementText}>{item}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

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
  backLabel = "← Back to Dashboard",
  readOnly = false,
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
    if (savedRef.current || sessionStorage.getItem(saveKey) || readOnly) {
      console.log('📝 Skipping save - already saved or read-only');
      return;
    }
    
    // Don't save mock data
    if (isMock) {
      console.log('📝 Skipping save - mock data');
      return;
    }

    // Save the session to Supabase
    const saveSession = async () => {
      try {
        console.log('💾 Saving session to Supabase...');
        
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
           console.error('No user found, cannot save session');
           return;
        }

          // Check if already saved in Supabase to prevent duplicates
          const { data: existing } = await supabase
            .from('sessions')
            .select('id')
            .eq('user_id', user.id)
            .eq('created_at', new Date(sessionCreatedAt.current).toISOString())
            .maybeSingle();

          if (existing) {
             console.log('📝 Skipping save - session already exists in DB');
             savedRef.current = true;
             return;
          }

        const { error } = await supabase.from('sessions').insert({
            user_id: user.id,
            theme,
            quote,
            transcript,
            // Competitive scores
            overall_score: analysis.overallScore,
            content_score: analysis.categoryScores.content.score,
            delivery_score: analysis.categoryScores.delivery.score,
            language_score: analysis.categoryScores.language.score,
            body_language_score: analysis.categoryScores.bodyLanguage.score,
            // Stats
            duration: analysis.speechStats.duration,
            word_count: analysis.speechStats.wordCount,
            wpm: analysis.speechStats.wpm,
            filler_word_count: analysis.speechStats.fillerWordCount,
            // Feedback
            performance_tier: analysis.performanceTier,
            tournament_ready: analysis.tournamentReady,
            strengths: analysis.strengths,
            practice_drill: analysis.practiceDrill,
            // Meta
            video_filename: videoFilename,
            created_at: new Date(sessionCreatedAt.current).toISOString(),
            // Store full analysis as JSON string for future-proofing
            full_analysis_json: JSON.stringify(analysis),
        });

        if (error) throw error;

        savedRef.current = true;
        sessionStorage.setItem(saveKey, 'true');
        console.log('✅ Session saved to Supabase');
      } catch (error) {
        console.error('❌ Failed to save session:', error);
      }
    };

    saveSession();
  }, [sessionId, analysis, theme, quote, transcript, videoFilename, isMock, readOnly]);

  // Helper to render a score circle
  const renderScoreRing = (score: number, label: string, weight: string) => {
    // Tournament Yellow styling
    const color = '#ca8a04'; 
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

  // -------------------------------------------
  // STATS BAR (single source of truth w/ fallbacks)
  // -------------------------------------------
  const derivedWordCount = useMemo(() => {
    const t = (transcript || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }, [transcript]);

  const statsDuration =
    analysis.speechStats?.duration && analysis.speechStats.duration !== 'string'
      ? analysis.speechStats.duration
      : '—';

  const statsWords =
    typeof analysis.speechStats?.wordCount === 'number' && analysis.speechStats.wordCount > 0
      ? analysis.speechStats.wordCount
      : derivedWordCount;

  const statsWpm =
    typeof analysis.speechStats?.wpm === 'number' && analysis.speechStats.wpm > 0
      ? analysis.speechStats.wpm
      : (analysis.deliveryAnalysis?.pacing?.wpm || 0);

  const statsFillers =
    typeof analysis.speechStats?.fillerWordCount === 'number' && analysis.speechStats.fillerWordCount > 0
      ? analysis.speechStats.fillerWordCount
      : (analysis.deliveryAnalysis?.fillerWords?.total || 0);

  return (
    <div style={styles.container}>
      {/* Top Navigation */}
      <button onClick={onGoHome} style={styles.backLink}>
        {backLabel}
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
          <div style={styles.statsBarValue}>{statsDuration}</div>
          </div>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>WORDS</div>
          <div style={styles.statsBarValue}>{statsWords}</div>
        </div>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>PACE</div>
          <div style={styles.statsBarValue}>{statsWpm} WPM</div>
        </div>
        <div style={styles.statsBarItem}>
          <div style={styles.statsBarLabel}>FILLERS</div>
          <div style={styles.statsBarValue}>{statsFillers} total</div>
        </div>
      </div>

      {/* Main Content Two Columns */}
      <div style={styles.contentGrid}>
        {/* Left Column */}
        <div style={styles.leftCol}>
          {/* CONTENT ANALYSIS */}
          <div style={styles.analysisSectionWithBg}>
            <h2 style={styles.sectionHeader}>| Content Analysis (40%)</h2>
            <AnalysisItem 
              title="Topic Adherence" 
              score={analysis.contentAnalysis.topicAdherence.score} 
              feedback={analysis.contentAnalysis.topicAdherence.feedback} 
            />
            <AnalysisItem 
              title="Argument Structure" 
              score={analysis.contentAnalysis.argumentStructure.score} 
              feedback={analysis.contentAnalysis.argumentStructure.feedback} 
            />
            <AnalysisItem 
              title="Depth of Analysis" 
              score={analysis.contentAnalysis.depthOfAnalysis.score} 
              feedback={analysis.contentAnalysis.depthOfAnalysis.feedback} 
            />
          </div>

          {/* DELIVERY ANALYSIS */}
          <div style={styles.analysisSectionWithBg}>
            <h2 style={styles.sectionHeader}>| Delivery Analysis (30%)</h2>
            <AnalysisItem 
              title="Vocal Variety" 
              score={analysis.deliveryAnalysis.vocalVariety.score} 
              feedback={analysis.deliveryAnalysis.vocalVariety.feedback} 
            />
            <AnalysisItem 
              title="Pacing & Tempo" 
              score={analysis.deliveryAnalysis.pacing.score} 
              feedback={analysis.deliveryAnalysis.pacing.feedback} 
              // Force WPM to match the calculated stats bar
              customMetric={`${statsWpm} WPM`}
            />
            
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

          {/* LANGUAGE ANALYSIS */}
          <div style={styles.analysisSectionWithBg}>
            <h2 style={styles.sectionHeader}>| Language Use (15%)</h2>
            <AnalysisItem 
              title="Vocabulary Sophistication" 
              score={analysis.languageAnalysis.vocabulary.score} 
              feedback={analysis.languageAnalysis.vocabulary.feedback} 
            />
            <AnalysisItem 
              title="Rhetorical Devices" 
              score={analysis.languageAnalysis.rhetoricalDevices.score} 
              feedback={analysis.languageAnalysis.rhetoricalDevices.feedback} 
            />
          </div>

          {/* BODY LANGUAGE ANALYSIS */}
          <div style={styles.analysisSectionWithBg}>
            <h2 style={styles.sectionHeader}>| Body Language & Presence (15%)</h2>
            <AnalysisItem 
              title="Eye Contact" 
              score={analysis.bodyLanguageAnalysis.eyeContact.score} 
              feedback={analysis.bodyLanguageAnalysis.eyeContact.feedback} 
            />
            <AnalysisItem 
              title="Gestures & Posture" 
              score={analysis.bodyLanguageAnalysis.gestures.score} 
              feedback={analysis.bodyLanguageAnalysis.gestures.feedback} 
            />
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
          <div style={styles.overallScoreCard}>
            <div style={styles.overallScoreTop}>OVERALL SCORE</div>
            <div style={{ ...styles.overallScoreValue, color: '#ca8a04' }}>
              {analysis.overallScore.toFixed(1)}<span style={styles.overallMax}>/10.0</span>
            </div>
            <div style={styles.readinessRow}>
              Tournament Ready: <span style={{ fontWeight: 700, color: analysis.tournamentReady ? '#059669' : '#dc2626' }}>{analysis.tournamentReady ? 'YES' : 'NO'}</span>
            </div>
          </div>

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
    marginBottom: '32px',
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
    gap: '40px',
    alignItems: 'flex-start',
  },
  leftCol: {
    flex: 1.6,
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
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
    padding: '24px',
    marginBottom: '16px',
  },
  sectionHeader: {
    fontSize: '1.15rem',
    fontWeight: 800,
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
  },
  analysisItem: {
    marginBottom: '16px',
  },
  analysisHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  analysisTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  scoreBadge: {
    background: '#111111',
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '0.8rem',
    fontWeight: 700,
  },
  customMetricBadge: {
    background: '#f3f4f6',
    color: '#374151',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '0.8rem',
    fontWeight: 600,
    border: '1px solid #e5e7eb',
  },
  analysisScore: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  expandButton: {
    background: 'none',
    border: 'none',
    color: '#0066cc',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    transition: 'background 0.2s',
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
  feedbackContainerCompact: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '20px',
    background: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #f0f0f0',
  },
  expandedContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  divider: {
    height: '1px',
    background: '#f0f0f0',
    width: '100%',
  },
  justificationText: {
    fontSize: '1rem',
    lineHeight: 1.6,
    color: '#111111',
    margin: 0,
    fontWeight: 500,
  },
  detailSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  detailLabel: {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#999999',
    letterSpacing: '0.05em',
  },
  evidenceList: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  evidenceItem: {
    fontSize: '0.95rem',
    color: '#444444',
    lineHeight: 1.5,
  },
  meaningText: {
    fontSize: '0.95rem',
    lineHeight: 1.5,
    color: '#666666',
    margin: 0,
    fontStyle: 'italic',
  },
  improvementGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '16px',
  },
  improvementCard: {
    background: '#f8fafc',
    padding: '16px',
    borderRadius: '8px',
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    border: '1px solid #e2e8f0',
  },
  improvementNumber: {
    background: '#000000',
    color: '#ffffff',
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.7rem',
    fontWeight: 800,
    flexShrink: 0,
    marginTop: '2px',
  },
  improvementText: {
    fontSize: '0.9rem',
    lineHeight: 1.5,
    color: '#334155',
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
    position: 'sticky',
    top: '40px',
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

