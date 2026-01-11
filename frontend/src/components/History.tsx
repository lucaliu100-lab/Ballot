/**
 * History Component - Redesigned
 * 
 * Layout:
 * - Left (60%): "History" heading + list of recent rounds
 *   - Clicking a round expands to show the RFD
 *   - "Open Full Ballot" button at the bottom of expanded RFD
 * - Right (40%): Performance trends chart + stats (total rounds, avg score)
 * 
 * Design: Black, white, and gray only
 */

import { useMemo, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface HistoryProps {
  onClose: () => void;
  onSelectSession?: (session: any) => void;
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isCorruptOverallScore(score: unknown): boolean {
  const n = safeNumber(score);
  if (n === null) return false;
  return n < 0 || n > 10;
}

function countWordsSafe(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function isInsufficientSpeechSession(session: any): boolean {
  const wcField = typeof session.wordCount === 'number' ? session.wordCount : undefined;
  const wc = typeof wcField === 'number' && Number.isFinite(wcField) ? wcField : countWordsSafe(session.transcript);

  if (wc > 0 && wc < 25) return true;

  const raw = session.fullAnalysisJson;
  if (!raw) return false;
  try {
    const analysis = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const issue = String(analysis?.priorityImprovements?.[0]?.issue || '');
    const feedback = String(analysis?.contentAnalysis?.topicAdherence?.feedback || '');
    if (/no usable speech detected/i.test(issue)) return true;
    if (/INSUFFICIENT SPEECH DATA/i.test(feedback)) return true;
  } catch {
    // ignore
  }
  return false;
}

function getSessionDuration(session: any): number {
  if (typeof session.durationSeconds === 'number' && session.durationSeconds > 0) {
    return session.durationSeconds;
  }
  
  if (session.fullAnalysisJson) {
    try {
      const analysis = typeof session.fullAnalysisJson === 'string' 
        ? JSON.parse(session.fullAnalysisJson) 
        : session.fullAnalysisJson;
          
      if (analysis?.speechStats?.duration) {
        const d = analysis.speechStats.duration;
        if (typeof d === 'string' && d.includes(':')) {
          const parts = d.split(':').map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return (parts[0] * 60) + parts[1];
          }
        }
      }
      // Championship format
      if (analysis?.speechStats?.durationSec) {
        return analysis.speechStats.durationSec;
      }
    } catch {
      // ignore
    }
  }
  
  if (typeof session.duration === 'string' && session.duration.includes(':')) {
    const parts = session.duration.split(':').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return (parts[0] * 60) + parts[1];
    }
  }

  return 0;
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get classification/warning from session
function getSessionWarning(session: any): string | null {
  const raw = session.fullAnalysisJson;
  if (!raw) return null;
  
  try {
    const analysis = typeof raw === 'string' ? JSON.parse(raw) : raw;
    
    // Championship format
    if (analysis?.classification?.label && analysis.classification.label !== 'normal') {
      const labelMap: Record<string, string> = {
        'too_short': 'Too Short',
        'nonsense': 'Nonsense',
        'off_topic': 'Off Topic',
        'mostly_off_topic': 'Mostly Off Topic',
      };
      return labelMap[analysis.classification.label] || null;
    }
    
    // Legacy format
    if (analysis?.classification && analysis.classification !== 'normal') {
      const labelMap: Record<string, string> = {
        'too_short': 'Too Short',
        'nonsense': 'Nonsense',
        'off_topic': 'Off Topic',
        'mostly_off_topic': 'Mostly Off Topic',
      };
      return labelMap[analysis.classification] || null;
    }
  } catch {
    // ignore
  }
  
  // Check duration
  const duration = getSessionDuration(session);
  if (duration > 0 && duration < 120) {
    return 'Too Short';
  }
  
  return null;
}

// Get RFD from session
function getSessionRFD(session: any): { summary: string; whyThisScore?: Array<{ claim: string }>; whyNotHigher?: { nextBand: string; blockers: Array<{ blocker: string }> } } | null {
  const raw = session.fullAnalysisJson;
  if (!raw) return null;
  
  try {
    const analysis = typeof raw === 'string' ? JSON.parse(raw) : raw;
    
    // Championship format - has rfd object
    if (analysis?.rfd?.summary) {
      return analysis.rfd;
    }
    
    // Legacy format - construct from priority improvements
    if (analysis?.priorityImprovements?.length > 0) {
      const topIssues = analysis.priorityImprovements.slice(0, 3);
      const summary = topIssues.map((pi: any) => `${pi.issue}: ${pi.impact}`).join(' ');
      return { summary };
    }
    
    // Fallback to strengths
    if (analysis?.strengths?.length > 0) {
      return { summary: `Strengths: ${analysis.strengths.join(', ')}` };
    }
  } catch {
    // ignore
  }
  
  return null;
}

function History({ onClose, onSelectSession }: HistoryProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionsData, setSessionsData] = useState<any[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        if (!supabase) {
          setError('Supabase is not configured.');
          return;
        }
        const { data, error } = await supabase
          .from('sessions')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) throw error;

        const corruptIds = (data || [])
          .filter((s: any) => isCorruptOverallScore(s?.overall_score))
          .map((s: any) => String(s.id))
          .filter(Boolean);

        if (corruptIds.length > 0) {
          try {
            const { data: auth } = await supabase.auth.getUser();
            const userId = auth?.user?.id;
            if (userId) {
              await supabase
                .from('sessions')
                .delete()
                .eq('user_id', userId)
                .in('id', corruptIds);
            }
          } catch {
            // ignore
          }
        }

        const mapped = (data || [])
          .filter((s: any) => !isCorruptOverallScore(s?.overall_score))
          .map(s => ({
            id: s.id,
            theme: s.theme,
            quote: s.quote,
            transcript: s.transcript,
            createdAt: new Date(s.created_at).getTime(),
            overallScore: s.overall_score,
            contentScore: s.content_score,
            deliveryScore: s.delivery_score,
            languageScore: s.language_score,
            bodyLanguageScore: s.body_language_score,
            duration: s.duration,
            wordCount: s.word_count,
            wpm: s.wpm,
            fillerCount: s.filler_word_count,
            fillerWordCount: s.filler_word_count,
            performanceTier: s.performance_tier,
            tournamentReady: s.tournament_ready,
            strengths: s.strengths,
            practiceDrill: s.practice_drill,
            videoFilename: s.video_filename,
            fullAnalysisJson: s.full_analysis_json
          }));
        
        setSessionsData(mapped);
      } catch (err) {
        console.error(err);
        setError('Failed to load history');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const sessions = useMemo(() => sessionsData, [sessionsData]);

  const sessionsCanonical = useMemo(() => {
    const seen = new Set<string>();
    return sessions.filter((s: any) => {
      if (isInsufficientSpeechSession(s)) return false;
      const key = s.videoFilename || `${s.theme}-${s.quote}-${String(s.transcript || '').substring(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [sessions]);

  const sessionsForList = useMemo(() => {
    return [...sessionsCanonical].reverse();
  }, [sessionsCanonical]);

  const getSessionAvgScore = (session: any): number => {
    if (session.overallScore !== undefined) {
      const n = safeNumber(session.overallScore);
      if (n !== null) return Math.max(0, Math.min(10, n));
    }
    if (session.contentScore !== undefined && session.deliveryScore !== undefined && session.languageScore !== undefined) {
      return Number(((session.contentScore * 0.4) + (session.deliveryScore * 0.3) + (session.languageScore * 0.15) + (session.bodyLanguageScore || 0) * 0.15).toFixed(1));
    }
    return 0;
  };

  const totalSessions = sessionsCanonical.length;
  const scores = sessionsCanonical.map(getSessionAvgScore);
  const averageScore = totalSessions > 0 ? scores.reduce((a, b) => a + b, 0) / totalSessions : 0;

  const chartData = sessionsCanonical.map((s, i) => ({
    session: i + 1,
    score: getSessionAvgScore(s),
  }));

  const handleToggleSession = (sessionId: string) => {
    setExpandedSessionId(expandedSessionId === sessionId ? null : sessionId);
  };

  const handleOpenFullBallot = (session: any) => {
    if (onSelectSession) {
      onSelectSession(session);
    }
  };

  // Loading State
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingWrapper}>
          <div style={styles.loadingSpinner}></div>
          <p style={styles.loadingText}>Loading history...</p>
        </div>
        <style>{loadingStyles}</style>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorWrapper}>
          <h2 style={styles.errorTitle}>Failed to load history</h2>
          <p style={styles.errorText}>There was a problem connecting to the database.</p>
          <div style={styles.errorButtons}>
            <button onClick={() => window.location.reload()} style={styles.retryButton}>Retry</button>
            <button onClick={onClose} style={styles.backButtonSmall}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={onClose} style={styles.backButton}>← Back to Dashboard</button>
      </div>

      {/* Main Layout */}
      <div style={styles.mainLayout} className="main-layout">
        {/* Left Column - History List */}
        <div style={styles.leftColumn} className="left-column">
          <h1 style={styles.historyTitle}>History</h1>
          
          {sessionsForList.length > 0 ? (
            <div style={styles.historyList}>
              {sessionsForList.map((session: any) => {
                const score = getSessionAvgScore(session);
                const dateStr = formatDate(session.createdAt);
                const warning = getSessionWarning(session);
                const rfd = getSessionRFD(session);
                const isExpanded = expandedSessionId === session.id;
                const duration = getSessionDuration(session);

                return (
                  <div key={session.id} style={styles.historyItem}>
                    {/* Clickable Header */}
                    <button
                      onClick={() => handleToggleSession(session.id)}
                      style={styles.historyItemHeader}
                      className="history-item-header"
                    >
                      <div style={styles.historyItemLeft}>
                        <div style={styles.historyTheme}>{session.theme || 'Unknown Theme'}</div>
                        <div style={styles.historyMeta}>
                          <span style={styles.historyDate}>{dateStr}</span>
                          {duration > 0 && (
                            <>
                              <span style={styles.metaDot}>·</span>
                              <span style={styles.historyDuration}>{formatDuration(duration)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={styles.historyItemRight}>
                        {warning && (
                          <span style={styles.warningBadge}>{warning}</span>
                        )}
                        <span style={styles.historyScore}>{score.toFixed(1)}</span>
                        <span style={styles.expandIcon}>{isExpanded ? '−' : '+'}</span>
                      </div>
                    </button>

                    {/* Expanded RFD Content */}
                    {isExpanded && (
                      <div style={styles.expandedContent}>
                        {/* Quote */}
                        {session.quote && (
                          <div style={styles.quoteContainer}>
                            <div style={styles.quoteLabel}>Quote</div>
                            <p style={styles.quoteText}>"{session.quote}"</p>
                          </div>
                        )}
                        
                        {rfd ? (
                          <div style={styles.rfdContainer}>
                            <div style={styles.rfdLabel}>Reason for Decision</div>
                            <p style={styles.rfdSummary}>{rfd.summary}</p>
                            
                            {rfd.whyThisScore && rfd.whyThisScore.length > 0 && (
                              <div style={styles.rfdSection}>
                                <div style={styles.rfdSectionTitle}>Why This Score</div>
                                {rfd.whyThisScore.map((item, i) => (
                                  <p key={i} style={styles.rfdClaim}>• {item.claim}</p>
                                ))}
                              </div>
                            )}
                            
                            {rfd.whyNotHigher && rfd.whyNotHigher.blockers?.length > 0 && (
                              <div style={styles.rfdSection}>
                                <div style={styles.rfdSectionTitle}>
                                  Why Not {rfd.whyNotHigher.nextBand}?
                                </div>
                                {rfd.whyNotHigher.blockers.map((blocker, i) => (
                                  <p key={i} style={styles.rfdBlocker}>• {blocker.blocker}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p style={styles.noRfd}>No detailed feedback available for this round.</p>
                        )}
                        
                        <button
                          onClick={() => handleOpenFullBallot(session)}
                          style={styles.openBallotButton}
                        >
                          Open Full Ballot →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <p style={styles.emptyText}>No rounds yet.</p>
              <p style={styles.emptySubtext}>Complete your first round to see your history here.</p>
            </div>
          )}
        </div>

        {/* Right Column - Performance Trends */}
        <div style={styles.rightColumn} className="right-column">
          {/* Stats Cards */}
          <div style={styles.statsRow} className="stats-row">
            <div style={styles.statCard}>
              <div style={styles.statValue}>{totalSessions}</div>
              <div style={styles.statLabel}>Total Rounds</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{averageScore.toFixed(1)}</div>
              <div style={styles.statLabel}>Average Score</div>
            </div>
          </div>

          {/* Performance Trends Chart */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>Performance Trends</h3>
            {chartData.length > 0 ? (
              <div style={styles.chartContainer}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis 
                      dataKey="session" 
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e5e7eb' }}
                      label={{ value: 'Round', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#9ca3af' }}
                    />
                    <YAxis 
                      domain={[0, 10]}
                      ticks={[0, 2, 4, 6, 8, 10]}
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e5e7eb' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#fff', 
                        border: '1px solid #e5e7eb', 
                        borderRadius: '6px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                        fontSize: '13px'
                      }}
                      itemStyle={{ color: '#111827', fontWeight: 600 }}
                      labelStyle={{ color: '#6b7280', marginBottom: '4px' }}
                      formatter={(value: any) => [`${Number(value).toFixed(1)}`, 'Score']}
                      labelFormatter={(label) => `Round ${label}`}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="score" 
                      stroke="#111827" 
                      strokeWidth={2}
                      dot={{ r: 4, fill: '#111827', strokeWidth: 0 }}
                      activeDot={{ r: 6, fill: '#111827', strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={styles.chartEmpty}>
                <p style={styles.chartEmptyText}>Complete rounds to see your performance trends.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Responsive Styles */}
      <style>{responsiveStyles}</style>
    </div>
  );
}

// ===========================================
// STYLES - Black, White, Gray Only
// ===========================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#ffffff',
    fontFamily: "'Segoe UI', Roboto, sans-serif",
    padding: '24px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  
  // Header
  header: {
    marginBottom: '32px',
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    padding: 0,
  },
  
  // Main Layout
  mainLayout: {
    display: 'flex',
    gap: '40px',
  },
  
  // Left Column - History
  leftColumn: {
    flex: '1 1 60%',
    minWidth: 0,
  },
  historyTitle: {
    fontSize: '1.75rem',
    fontWeight: 800,
    color: '#111827',
    margin: '0 0 24px 0',
    letterSpacing: '-0.02em',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  historyItem: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
    background: '#ffffff',
  },
  historyItemHeader: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  historyItemLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  historyTheme: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#111827',
  },
  historyMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.85rem',
    color: '#9ca3af',
  },
  historyDate: {},
  metaDot: {
    color: '#d1d5db',
  },
  historyDuration: {},
  historyItemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  warningBadge: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#6b7280',
    background: '#f3f4f6',
    padding: '4px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  historyScore: {
    fontSize: '1.25rem',
    fontWeight: 800,
    color: '#111827',
  },
  expandIcon: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#9ca3af',
    width: '24px',
    textAlign: 'center',
  },
  
  // Expanded Content
  expandedContent: {
    borderTop: '1px solid #e5e7eb',
    padding: '20px',
    background: '#fafafa',
  },
  quoteContainer: {
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid #e5e7eb',
  },
  quoteLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px',
  },
  quoteText: {
    fontSize: '1rem',
    fontStyle: 'italic',
    color: '#374151',
    lineHeight: 1.6,
    margin: 0,
  },
  rfdContainer: {},
  rfdLabel: {
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px',
  },
  rfdSummary: {
    fontSize: '0.95rem',
    color: '#374151',
    lineHeight: 1.6,
    margin: '0 0 16px 0',
  },
  rfdSection: {
    marginBottom: '12px',
  },
  rfdSectionTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#6b7280',
    marginBottom: '6px',
  },
  rfdClaim: {
    fontSize: '0.9rem',
    color: '#4b5563',
    margin: '0 0 4px 0',
    lineHeight: 1.5,
  },
  rfdBlocker: {
    fontSize: '0.9rem',
    color: '#4b5563',
    margin: '0 0 4px 0',
    lineHeight: 1.5,
  },
  noRfd: {
    fontSize: '0.9rem',
    color: '#9ca3af',
    fontStyle: 'italic',
    margin: '0 0 16px 0',
  },
  openBallotButton: {
    marginTop: '16px',
    padding: '10px 20px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#ffffff',
    background: '#111827',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  
  // Right Column - Stats & Chart
  rightColumn: {
    flex: '1 1 40%',
    minWidth: '320px',
  },
  statsRow: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    flex: 1,
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#111827',
  },
  statLabel: {
    fontSize: '0.85rem',
    color: '#6b7280',
    marginTop: '4px',
  },
  chartCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
  },
  chartTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 16px 0',
  },
  chartContainer: {
    width: '100%',
    height: '280px',
  },
  chartEmpty: {
    height: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartEmptyText: {
    fontSize: '0.9rem',
    color: '#9ca3af',
    textAlign: 'center',
  },
  
  // Empty State
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    border: '1px dashed #e5e7eb',
    borderRadius: '8px',
  },
  emptyText: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#6b7280',
    margin: '0 0 8px 0',
  },
  emptySubtext: {
    fontSize: '0.9rem',
    color: '#9ca3af',
    margin: 0,
  },
  
  // Loading State
  loadingWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
  },
  loadingSpinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e5e7eb',
    borderTopColor: '#111827',
    borderRadius: '50%',
    marginBottom: '16px',
  },
  loadingText: {
    fontSize: '0.95rem',
    color: '#6b7280',
  },
  
  // Error State
  errorWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
  },
  errorTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 8px 0',
  },
  errorText: {
    fontSize: '0.95rem',
    color: '#6b7280',
    margin: '0 0 24px 0',
  },
  errorButtons: {
    display: 'flex',
    gap: '12px',
  },
  retryButton: {
    padding: '10px 20px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#ffffff',
    background: '#111827',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  backButtonSmall: {
    padding: '10px 20px',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#374151',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

const loadingStyles = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  div[style*="borderTopColor"] {
    animation: spin 0.8s linear infinite;
  }
`;

const responsiveStyles = `
  /* History item hover */
  .history-item-header {
    transition: background-color 0.15s ease;
  }
  .history-item-header:hover {
    background: #f9fafb !important;
  }
  
  /* Open ballot button hover */
  button[style*="background: #111827"]:hover,
  button[style*="background: rgb(17, 24, 39)"]:hover {
    background: #374151 !important;
  }
  
  /* Back button hover */
  button[style*="background: none"]:hover {
    color: #111827 !important;
  }
  
  /* Responsive - Tablet */
  @media (max-width: 1024px) {
    .main-layout {
      flex-direction: column !important;
      gap: 32px !important;
    }
    .left-column, .right-column {
      flex: 1 1 100% !important;
      min-width: 0 !important;
    }
    .right-column {
      order: -1;
    }
  }
  
  /* Responsive - Mobile */
  @media (max-width: 600px) {
    .stats-row {
      flex-direction: column !important;
    }
  }
`;

export default History;
