/**
 * StartScreen Component
 * 
 * The initial screen that shows a button to start a new practice round.
 * Refined for competitive impromptu speakers - Action & Achievement oriented.
 */

import { useState, useEffect } from 'react';
import { RoundData } from '../types';
import { API_ENDPOINTS } from '../lib/constants';
import { supabase } from '../lib/supabase';

function isInsufficientSessionRow(row: any): boolean {
  const wc = typeof row?.word_count === 'number' ? row.word_count : 0;
  if (wc > 0 && wc < 25) return true;
  const json = typeof row?.full_analysis_json === 'string' ? row.full_analysis_json : '';
  if (json && /INSUFFICIENT SPEECH DATA/i.test(json)) return true;
  return false;
}

function stableSessionKey(row: any): string {
  const vf = row?.video_filename ? String(row.video_filename) : '';
  if (vf) return `video:${vf}`;
  const theme = String(row?.theme || '');
  const quote = String(row?.quote || '');
  const transcript = String(row?.transcript || '').substring(0, 50);
  return `content:${theme}-${quote}-${transcript}`;
}

// Helper to determine tier based on recent average (last 5 sessions)
function getTier(sessions: any[]) {
  if (sessions.length === 0) return { name: 'Unranked', color: '#9ca3af' };
  
  const recent = sessions.slice(0, 5);
  const avg = recent.reduce((sum, s) => sum + (s.overall_score || 0), 0) / recent.length;

  if (avg >= 8) return { name: 'National Level', color: '#7c3aed' }; // Purple
  if (avg >= 6) return { name: 'Varsity', color: '#059669' }; // Green
  if (avg >= 4) return { name: 'Developing', color: '#d97706' }; // Amber
  return { name: 'Novice', color: '#dc2626' }; // Red
}

// Helper to determine trend based on last 3 sessions
function getTrend(sessions: any[]) {
  if (sessions.length < 2) return { label: 'No Trend', icon: '—', color: '#9ca3af' };
  
  // Get up to last 3 scores
  const scores = sessions.slice(0, 3).map(s => s.overall_score || 0);
  // Compare most recent to the oldest in the set (up to 3rd back)
  const current = scores[0];
  const baseline = scores[scores.length - 1];
  
  const diff = current - baseline;
  
  if (diff >= 0.5) return { label: 'Improving', icon: '↗', color: '#059669' };
  if (diff <= -0.5) return { label: 'Declining', icon: '↘', color: '#dc2626' };
  return { label: 'Stable', icon: '→', color: '#6b7280' };
}

// Props that this component receives from its parent
interface StartScreenProps {
  onRoundStart: (data: RoundData) => void;  // Called when round data is loaded
  onShowHistory: () => void; // Called to navigate to history
}

function StartScreen({ onRoundStart, onShowHistory }: StartScreenProps) {
  // Track loading state while fetching from API
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCtaHover, setIsCtaHover] = useState(false);
  
  // Dashboard Data State
  const [lastSession, setLastSession] = useState<any | null>(null);
  const [totalSessions, setTotalSessions] = useState<number>(0);
  const [validSessions, setValidSessions] = useState<any[]>([]);

  // Fetch dashboard data
  useEffect(() => {
    const fetchDashboardData = async () => {
      // Fetch sessions
      // We filter by word_count > 10 to get a more accurate count of "completed" attempts
      const { data: sessions, count } = await supabase
        .from('sessions')
        .select('*', { count: 'exact' })
        .gt('word_count', 10)
        .order('created_at', { ascending: false })
        .limit(20);

      if (count !== null) setTotalSessions(count);

      if (!sessions || sessions.length === 0) return;

      // Filter valid sessions for stats
      const seen = new Set<string>();
      const valid = sessions.filter((s) => {
        if (isInsufficientSessionRow(s)) return false;
        const key = stableSessionKey(s);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setValidSessions(valid);
      if (valid.length > 0) setLastSession(valid[0]);
    };

    fetchDashboardData();
  }, []);

  const tier = getTier(validSessions);
  const trend = getTrend(validSessions);

  // Handle the "Start" button click
  const handleStartRound = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🎬 Start Round: requesting /api/start-round...');

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10_000);

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
      onRoundStart(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Start round timed out. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score > 6) return '#059669'; // Green
    if (score >= 4) return '#eab308'; // Yellow
    return '#dc2626'; // Red
  };

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  };

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header Section */}
        <div style={styles.header}>
          <h1 style={styles.mainTitle}>Impromptu Speaking</h1>
          <div style={styles.divider}></div>
        </div>

        {/* Action Section - Top Priority */}
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

        {/* Stats Bar - Performance Metrics */}
        <div style={styles.statsBar}>
            {/* Total Sessions */}
            <div style={styles.statCard}>
                <div style={styles.statLabel}>Total Sessions</div>
                <div style={styles.statValue}>{totalSessions}</div>
            </div>

            {/* Current Tier */}
            <div style={styles.statCard}>
                <div style={styles.statLabel}>Current Tier</div>
                <div style={styles.tierValue} >
                    <span style={{ color: tier.color, marginRight: '8px' }}>●</span>
                    {tier.name}
                </div>
            </div>

            {/* Recent Trend */}
            <div style={styles.statCard}>
                <div style={styles.statLabel}>Recent Trend</div>
                <div style={styles.trendValue}>
                    <span style={{ 
                        color: trend.color, 
                        fontSize: '20px', 
                        marginRight: '6px',
                        fontWeight: 700 
                    }}>{trend.icon}</span>
                    {trend.label}
                </div>
            </div>
        </div>

        {/* How It Works - Compact */}
        <div style={styles.instructionsSection}>
            <div style={styles.instructionsHeader}>
                <h3 style={styles.instructionsTitle}>Process</h3>
            </div>
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

        {/* Performance History */}
        {lastSession && (
          <div style={styles.historySection}>
            <div style={styles.historyHeader}>
                <h3 style={styles.historyTitle}>Performance History</h3>
                <span style={styles.historySub}>Track Your Progress to Tournament Ready</span>
            </div>
            <div style={styles.sessionCard} onClick={onShowHistory}>
              <div style={styles.sessionLeft}>
                <div style={styles.sessionTheme}>{lastSession.theme}</div>
                <div style={styles.sessionDate}>{getRelativeTime(lastSession.created_at)}</div>
              </div>
              
              <div style={styles.sessionRight}>
                <div style={styles.scoreBadge} 
                     data-score-color={getScoreColor(lastSession.overall_score || 0)}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginRight: '6px' }}>SCORE</span>
                    <span style={{ 
                        fontSize: '24px', 
                        fontWeight: 800, 
                        color: getScoreColor(lastSession.overall_score || 0) 
                    }}>
                        {lastSession.overall_score?.toFixed(1) || '-'}
                    </span>
                </div>
                <div style={styles.arrowButton}>→</div>
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
    minHeight: '100vh',
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '900px',
    margin: '0 auto',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    paddingTop: '60px',
    paddingBottom: '100px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  
  // Header
  header: {
    width: '100%',
    textAlign: 'center',
    marginBottom: '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: '36px',
    fontWeight: 800,
    color: '#111827',
    margin: '0 0 16px 0',
    letterSpacing: '-0.02em',
  },
  divider: {
    width: '40px',
    height: '4px',
    backgroundColor: '#f3f4f6',
    borderRadius: '2px',
  },

  // Action (Start Button)
  actionSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '60px',
    width: '100%',
  },
  ctaButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    borderRadius: '16px',
    padding: '32px 120px',
    fontSize: '24px',
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

  // Stats Bar
  statsBar: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    gap: '20px',
    marginBottom: '60px',
  },
  statCard: {
    flex: 1,
    background: '#f9fafb',
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '1px solid #f3f4f6',
  },
  statLabel: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#6b7280',
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 800,
    color: '#111827',
  },
  tierValue: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#374151',
    display: 'flex',
    alignItems: 'center',
  },
  trendValue: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#374151',
    display: 'flex',
    alignItems: 'center',
  },

  // Compact Instructions
  instructionsSection: {
    width: '100%',
    marginBottom: '60px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px 32px',
    boxSizing: 'border-box',
  },
  instructionsHeader: {
    marginBottom: '16px',
    textAlign: 'center',
  },
  instructionsTitle: {
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#9ca3af',
    margin: 0,
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
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#f3f4f6',
    color: '#4b5563',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
  },
  stepText: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    textAlign: 'center',
  },
  stepArrow: {
    color: '#d1d5db',
    fontSize: '16px',
  },

  // History Section
  historySection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  historyHeader: {
    display: 'flex',
    flexDirection: 'column', // Stacked for subtext
    gap: '4px',
  },
  historyTitle: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#111827',
    margin: 0,
  },
  historySub: {
    fontSize: '13px',
    color: '#6b7280',
    fontWeight: 500,
  },
  sessionCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  },
  sessionLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sessionTheme: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
  },
  sessionDate: {
    fontSize: '13px',
    color: '#6b7280',
  },
  sessionRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
  },
  scoreBadge: {
    display: 'flex',
    alignItems: 'baseline',
  },
  arrowButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#f9fafb',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
  },
};

export default StartScreen;
