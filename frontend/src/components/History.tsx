/**
 * History / Progress Component
 * 
 * Displays the user's past practice sessions from InstantDB.
 * Shows:
 * - Fixed progress line graph on the right side
 * - List of sessions with scores, themes, WPM, duration, and dates
 * - Expandable details for each session
 * - Visual score indicators
 */

import { useState } from 'react';
import { db } from '../lib/instant';
import { getScoreColor, formatDate } from '../lib/utils';

interface HistoryProps {
  onClose: () => void;  // Go back to main app
}

// Helper to format duration
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function History({ onClose }: HistoryProps) {
  // ===========================================
  // DATA FETCHING
  // ===========================================

  const { isLoading, error, data } = db.useQuery({ sessions: {} });

  // Track which session is expanded
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ===========================================
  // HANDLERS
  // ===========================================

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // ===========================================
  // DATA PROCESSING
  // ===========================================

  // Sort sessions by date (oldest first for graph)
  const sessions = data?.sessions 
    ? [...data.sessions].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    : [];

  // Sessions for display (newest first)
  const sessionsForList = [...sessions].reverse();

  // Helper to calculate average score for a session
  const getSessionAvgScore = (session: typeof sessions[0]): number => {
    if (session.structureScore !== undefined && 
        session.contentScore !== undefined && 
        session.deliveryScore !== undefined) {
      return Math.round(
        ((session.structureScore as number) + 
         (session.contentScore as number) + 
         (session.deliveryScore as number)) / 3
      );
    }
    return (session.overallScore as number) || 0;
  };

  // Calculate stats
  const totalSessions = sessions.length;
  const averageScore = totalSessions > 0 
    ? sessions.reduce((sum, s) => sum + getSessionAvgScore(s), 0) / totalSessions
    : 0;

  // Calculate score trend
  const getScoreTrend = (): { trend: string; positive: boolean } => {
    if (sessions.length < 2) return { trend: 'N/A', positive: true };
    
    const recentSessions = sessions.slice(-5);
    const olderSessions = sessions.slice(0, Math.max(1, sessions.length - 5));
    
    const recentAvg = recentSessions.reduce((sum, s) => sum + getSessionAvgScore(s), 0) / recentSessions.length;
    const olderAvg = olderSessions.reduce((sum, s) => sum + getSessionAvgScore(s), 0) / olderSessions.length;
    
    const diff = recentAvg - olderAvg;
    const positive = diff >= 0;
    return { trend: `${positive ? '+' : ''}${diff.toFixed(1)}`, positive };
  };

  const scoreTrend = getScoreTrend();

  // ===========================================
  // LINE GRAPH COMPONENT (Large, Fixed)
  // ===========================================

  const renderLineGraph = () => {
    if (sessions.length < 2) {
      return (
        <div style={styles.graphPlaceholder}>
          <div style={styles.graphPlaceholderIcon}>📊</div>
          <p style={styles.graphPlaceholderText}>
            Complete at least 2 sessions to see your progress graph
          </p>
        </div>
      );
    }

    const scores = sessions.map(s => getSessionAvgScore(s));
    const maxScore = 10;
    const minScore = 0;
    const graphWidth = 100;
    const graphHeight = 60;
    const padding = { left: 8, right: 4, top: 6, bottom: 10 };
    const plotWidth = graphWidth - padding.left - padding.right;
    const plotHeight = graphHeight - padding.top - padding.bottom;

    // Generate points for the line
    const points = scores.map((score, index) => {
      const x = padding.left + (index / (scores.length - 1)) * plotWidth;
      const y = padding.top + plotHeight - ((score - minScore) / (maxScore - minScore)) * plotHeight;
      return { x, y, score };
    });

    // Create SVG path
    const pathD = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    // Create area path
    const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + plotHeight} L ${padding.left} ${padding.top + plotHeight} Z`;

    return (
      <div style={styles.graphWrapper}>
        <h3 style={styles.graphTitle}>📈 Score Progress</h3>
        <svg 
          viewBox={`0 0 ${graphWidth} ${graphHeight}`}
          style={styles.graphSvg}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Gradient definition */}
          <defs>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 5, 10].map((val) => {
            const y = padding.top + plotHeight - (val / maxScore) * plotHeight;
            return (
              <g key={val}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={padding.left + plotWidth}
                  y2={y}
                  stroke="#e5e5e5"
                  strokeWidth="0.3"
                  strokeDasharray="1,1"
                />
                <text
                  x={padding.left - 1}
                  y={y + 0.8}
                  fill="#999999"
                  fontSize="2.5"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path
            d={areaD}
            fill="url(#areaGradient)"
          />

          {/* Main line */}
          <path
            d={pathD}
            fill="none"
            stroke="#059669"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {points.map((point, index) => (
            <g key={index}>
              <circle
                cx={point.x}
                cy={point.y}
                r="1.5"
                fill="#ffffff"
                stroke="#059669"
                strokeWidth="0.8"
              />
              {/* Score label on hover area */}
              <text
                x={point.x}
                y={point.y - 2.5}
                fill="#059669"
                fontSize="2"
                textAnchor="middle"
                fontWeight="600"
              >
                {point.score}
              </text>
            </g>
          ))}

          {/* Session numbers */}
          {points.map((point, index) => (
            <text
              key={index}
              x={point.x}
              y={graphHeight - 2}
              fill="#999999"
              fontSize="2"
              textAnchor="middle"
            >
              {index + 1}
            </text>
          ))}
        </svg>
        <div style={styles.graphLegend}>
          <span style={styles.graphLegendText}>Session #</span>
        </div>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={onClose} style={styles.backButton}>
          ← Back
        </button>
        <h1 style={styles.title}>History / Progress</h1>
        <p style={styles.subtitle}>Track your speech practice journey</p>
      </div>

      {/* Main Layout: Two columns */}
      <div style={styles.mainLayout}>
        {/* Left Column: Sessions List */}
        <div style={styles.leftColumn}>
          {/* Stats Summary */}
          {totalSessions > 0 && (
            <div style={styles.statsBox}>
              <div style={styles.statItem}>
                <span style={styles.statValue}>{totalSessions}</span>
                <span style={styles.statLabel}>Sessions</span>
              </div>
              <div style={styles.statItem}>
                <span style={{ ...styles.statValue, color: getScoreColor(averageScore) }}>
                  {averageScore.toFixed(1)}
                </span>
                <span style={styles.statLabel}>Avg Score</span>
              </div>
              <div style={styles.statItem}>
                <span style={{ 
                  ...styles.statValue, 
                  color: scoreTrend.positive ? '#059669' : '#dc2626' 
                }}>
                  {scoreTrend.trend}
                </span>
                <span style={styles.statLabel}>Trend</span>
              </div>
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div style={styles.loadingBox}>
              <div style={styles.spinner} />
              <p>Loading your sessions...</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div style={styles.errorBox}>
              Error loading sessions: {error.message}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && sessions.length === 0 && (
            <div style={styles.emptyBox}>
              <h3 style={styles.emptyTitle}>No sessions yet</h3>
              <p style={styles.emptyText}>
                Complete a practice session to see your history here.
              </p>
            </div>
          )}

          {/* Sessions list */}
          {!isLoading && sessionsForList.length > 0 && (
            <div style={styles.sessionsList}>
              <h3 style={styles.sessionsListTitle}>All Sessions</h3>
              {sessionsForList.map((session, index) => (
                <div key={session.id} style={styles.sessionCard}>
                  {/* Session header */}
                  <div 
                    style={styles.sessionHeader}
                    onClick={() => toggleExpand(session.id)}
                  >
                    <div style={styles.sessionLeft}>
                      <div 
                        style={{
                          ...styles.scoreCircle,
                          borderColor: getScoreColor(getSessionAvgScore(session)),
                        }}
                      >
                        <span style={{ color: getScoreColor(getSessionAvgScore(session)) }}>
                          {getSessionAvgScore(session)}
                        </span>
                      </div>
                      <div style={styles.sessionInfo}>
                        <div style={styles.sessionThemeRow}>
                          <span style={styles.sessionTheme}>{session.theme || 'Unknown Theme'}</span>
                          <span style={styles.sessionNumber}>#{sessionsForList.length - index}</span>
                        </div>
                        <div style={styles.sessionMeta}>
                          <span style={styles.sessionDate}>
                            {session.createdAt ? formatDate(session.createdAt) : 'Unknown date'}
                          </span>
                          {session.wordsPerMinute !== undefined && (
                            <span style={styles.sessionWpm}>
                              {session.wordsPerMinute} WPM
                            </span>
                          )}
                          {session.durationSeconds !== undefined && (
                            <span style={styles.sessionDuration}>
                              {formatDuration(session.durationSeconds as number)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span style={styles.expandIcon}>
                      {expandedId === session.id ? '−' : '+'}
                    </span>
                  </div>

                  {/* Expanded details */}
                  {expandedId === session.id && (
                    <div style={styles.sessionDetails}>
                      {/* Quote */}
                      <div style={styles.detailSection}>
                        <span style={styles.detailLabel}>Quote:</span>
                        <span style={styles.detailQuote}>"{session.quote}"</span>
                      </div>

                      {/* Score breakdown */}
                      {session.structureScore !== undefined && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>Scores:</span>
                          <div style={styles.scoresGrid}>
                            <div style={styles.scoreBox}>
                              <span style={styles.scoreBoxValue}>{session.structureScore}</span>
                              <span style={styles.scoreBoxLabel}>Structure</span>
                            </div>
                            <div style={styles.scoreBox}>
                              <span style={styles.scoreBoxValue}>{session.contentScore}</span>
                              <span style={styles.scoreBoxLabel}>Content</span>
                            </div>
                            <div style={styles.scoreBox}>
                              <span style={styles.scoreBoxValue}>{session.deliveryScore}</span>
                              <span style={styles.scoreBoxLabel}>Delivery</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Speech Stats */}
                      {(session.wordCount || session.wordsPerMinute || session.durationSeconds || session.fillerCount) && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>Speech Stats:</span>
                          <div style={styles.statsRow}>
                            {session.durationSeconds !== undefined && (
                              <span style={styles.statBadge}>⏱️ {formatDuration(session.durationSeconds as number)}</span>
                            )}
                            {session.wordCount !== undefined && (
                              <span style={styles.statBadge}>📝 {session.wordCount} words</span>
                            )}
                            {session.wordsPerMinute !== undefined && (
                              <span style={styles.statBadge}>🎯 {session.wordsPerMinute} WPM</span>
                            )}
                            {session.fillerCount !== undefined && (
                              <span style={styles.statBadge}>💬 {session.fillerCount} fillers</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Content Summary */}
                      {session.contentSummary && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>Content Summary:</span>
                          <p style={styles.detailSummary}>{session.contentSummary}</p>
                        </div>
                      )}

                      {/* Practice Drill */}
                      {session.practiceDrill && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>Practice Drill:</span>
                          <p style={styles.detailDrill}>{session.practiceDrill}</p>
                        </div>
                      )}

                      {/* Legacy Summary */}
                      {session.summary && !session.contentSummary && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>Summary:</span>
                          <p style={styles.detailText}>{session.summary}</p>
                        </div>
                      )}

                      {/* Strengths */}
                      {session.strengths && (session.strengths as string[]).length > 0 && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>✓ Strengths:</span>
                          <ul style={styles.detailList}>
                            {(session.strengths as string[]).map((s, i) => (
                              <li key={i} style={styles.strengthItem}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Areas to improve */}
                      {((session.areasForImprovement && (session.areasForImprovement as string[]).length > 0) ||
                        (session.improvements && (session.improvements as string[]).length > 0)) && (
                        <div style={styles.detailSection}>
                          <span style={styles.detailLabel}>↑ Areas to Improve:</span>
                          <ul style={styles.detailList}>
                            {((session.improvements || session.areasForImprovement) as string[]).map((a, i) => (
                              <li key={i} style={styles.improveItem}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Fixed Graph */}
        <div style={styles.rightColumn}>
          <div style={styles.graphContainer}>
            {renderLineGraph()}
          </div>
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
    marginBottom: '32px',
  },
  backButton: {
    background: 'transparent',
    color: '#333333',
    border: 'none',
    fontSize: '0.95rem',
    cursor: 'pointer',
    padding: '0',
    marginBottom: '16px',
    display: 'inline-block',
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
    fontSize: '1rem',
    margin: 0,
  },
  mainLayout: {
    display: 'flex',
    gap: '48px',
    alignItems: 'flex-start',
  },
  leftColumn: {
    flex: '1',
    maxWidth: '700px',
  },
  rightColumn: {
    width: '400px',
    flexShrink: 0,
    position: 'sticky',
    top: '100px',
    alignSelf: 'flex-start',
  },
  graphContainer: {
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: '12px',
    padding: '24px',
  },
  graphWrapper: {
    width: '100%',
  },
  graphTitle: {
    color: '#111111',
    fontSize: '1.1rem',
    fontWeight: 600,
    margin: '0 0 20px 0',
  },
  graphSvg: {
    width: '100%',
    height: '250px',
  },
  graphLegend: {
    textAlign: 'center',
    marginTop: '8px',
  },
  graphLegendText: {
    color: '#999999',
    fontSize: '0.85rem',
  },
  graphPlaceholder: {
    padding: '60px 24px',
    textAlign: 'center',
  },
  graphPlaceholderIcon: {
    fontSize: '3rem',
    marginBottom: '16px',
  },
  graphPlaceholderText: {
    color: '#999999',
    fontSize: '0.95rem',
    margin: 0,
  },
  statsBox: {
    display: 'flex',
    gap: '48px',
    marginBottom: '32px',
    padding: '24px 32px',
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statValue: {
    color: '#111111',
    fontSize: '2rem',
    fontWeight: 700,
  },
  statLabel: {
    color: '#666666',
    fontSize: '0.9rem',
  },
  loadingBox: {
    color: '#666666',
    padding: '48px',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e5e5e5',
    borderTop: '3px solid #000000',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #dc2626',
    color: '#dc2626',
    padding: '20px',
    borderRadius: '8px',
  },
  emptyBox: {
    padding: '48px 0',
  },
  emptyTitle: {
    color: '#111111',
    fontSize: '1.2rem',
    margin: '0 0 8px 0',
  },
  emptyText: {
    color: '#666666',
    fontSize: '0.95rem',
    margin: 0,
  },
  sessionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sessionsListTitle: {
    color: '#111111',
    fontSize: '1.1rem',
    fontWeight: 600,
    margin: '0 0 16px 0',
  },
  sessionCard: {
    background: '#ffffff',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  sessionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px',
    cursor: 'pointer',
    transition: 'background 0.2s ease',
  },
  sessionLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flex: 1,
  },
  scoreCircle: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: '3px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '1.1rem',
    background: '#ffffff',
    flexShrink: 0,
  },
  sessionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },
  sessionThemeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sessionTheme: {
    color: '#111111',
    fontSize: '1rem',
    fontWeight: 500,
  },
  sessionNumber: {
    color: '#999999',
    fontSize: '0.8rem',
    background: '#f0f0f0',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  sessionMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  sessionDate: {
    color: '#666666',
    fontSize: '0.85rem',
  },
  sessionWpm: {
    color: '#059669',
    fontSize: '0.8rem',
    fontWeight: 500,
  },
  sessionDuration: {
    color: '#6366f1',
    fontSize: '0.8rem',
    fontWeight: 500,
  },
  expandIcon: {
    color: '#333333',
    fontSize: '1.2rem',
    fontWeight: 600,
    flexShrink: 0,
  },
  sessionDetails: {
    padding: '0 20px 20px 20px',
    borderTop: '1px solid #e5e5e5',
  },
  detailSection: {
    marginTop: '16px',
  },
  detailLabel: {
    color: '#666666',
    fontSize: '0.9rem',
    display: 'block',
    marginBottom: '8px',
    fontWeight: 500,
  },
  detailQuote: {
    color: '#333333',
    fontSize: '0.95rem',
    fontStyle: 'italic',
  },
  detailText: {
    color: '#333333',
    fontSize: '0.95rem',
    lineHeight: 1.7,
    margin: 0,
  },
  detailSummary: {
    color: '#333333',
    fontSize: '0.95rem',
    lineHeight: 1.7,
    margin: 0,
    padding: '12px 16px',
    background: '#f8fafc',
    borderRadius: '6px',
    borderLeft: '3px solid #6366f1',
  },
  detailDrill: {
    color: '#333333',
    fontSize: '0.95rem',
    lineHeight: 1.7,
    margin: 0,
    padding: '12px 16px',
    background: '#f0f9ff',
    borderRadius: '6px',
    borderLeft: '3px solid #0284c7',
  },
  scoresGrid: {
    display: 'flex',
    gap: '16px',
  },
  scoreBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 20px',
    background: '#fafafa',
    borderRadius: '8px',
    border: '1px solid #e5e5e5',
  },
  scoreBoxValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#111111',
  },
  scoreBoxLabel: {
    fontSize: '0.75rem',
    color: '#666666',
    marginTop: '4px',
  },
  statsRow: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  statBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 12px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    fontSize: '0.85rem',
    color: '#334155',
  },
  detailList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  strengthItem: {
    color: '#333333',
    fontSize: '0.9rem',
    padding: '10px 12px',
    marginBottom: '6px',
    background: '#ecfdf5',
    borderLeft: '3px solid #059669',
    borderRadius: '0 6px 6px 0',
  },
  improveItem: {
    color: '#333333',
    fontSize: '0.9rem',
    padding: '10px 12px',
    marginBottom: '6px',
    background: '#fffbeb',
    borderLeft: '3px solid #d97706',
    borderRadius: '0 6px 6px 0',
  },
};

export default History;
