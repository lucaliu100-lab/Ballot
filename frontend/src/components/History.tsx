/**
 * History / Progress Component
 * 
 * Displays:
 * - Top Section: 6 Key Metric Cards + Tournament Readiness Dashboard
 * - Performance Trends Chart
 * - Bottom Section: Priority Improvements (Left, Sticky) + Recent Rounds List (Right)
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

function countWordsSafe(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function isInsufficientSpeechSession(session: any): boolean {
  // Prefer persisted word_count if available
  const wcField = typeof session.wordCount === 'number' ? session.wordCount : undefined;
  const wc = typeof wcField === 'number' && Number.isFinite(wcField) ? wcField : countWordsSafe(session.transcript);

  if (wc > 0 && wc < 25) return true;

  // Some legacy guarded analyses stored wordCount=0; use heuristic from fullAnalysisJson
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

// Helper to format duration with bug fix (rounding)
function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function calculateStdDev(values: number[]): number {
  if (!values || values.length < 2) return 0;
  // Filter out NaNs just in case
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length < 2) return 0;

  const avg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
  const squareDiffs = validValues.map(v => Math.pow(v - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / validValues.length;
  return Math.sqrt(avgSquareDiff);
}

  // Helper to safely extract duration
function getSessionDuration(session: any): number {
  if (typeof session.durationSeconds === 'number' && session.durationSeconds > 0) {
    return session.durationSeconds;
  }
  
  // Check fullAnalysisJson
  if (session.fullAnalysisJson) {
      try {
        const analysis = typeof session.fullAnalysisJson === 'string' 
            ? JSON.parse(session.fullAnalysisJson) 
            : session.fullAnalysisJson;
            
        if (analysis?.speechStats?.duration) {
             const d = analysis.speechStats.duration; // "MM:SS"
             if (typeof d === 'string' && d.includes(':')) {
                 const parts = d.split(':').map(Number);
                 if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    return (parts[0] * 60) + parts[1];
                 }
             }
        }
      } catch (e) {
        // ignore parse error
      }
  }
  
  // Fallback to older string field
  if (typeof session.duration === 'string' && session.duration.includes(':')) {
       const parts = session.duration.split(':').map(Number);
       if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return (parts[0] * 60) + parts[1];
       }
  }

  return 0;
}

function History({ onClose, onSelectSession }: HistoryProps) {
  // ===========================================
  // DATA FETCHING
  // ===========================================

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionsData, setSessionsData] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('sessions')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) throw error;

        // Map snake_case to camelCase for compatibility
        const mapped = (data || []).map(s => ({
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
          fillerCount: s.filler_word_count, // Component uses fillerCount or fillerWordCount
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

  // ===========================================
  // DATA PROCESSING & METRICS
  // ===========================================

  const sessions = useMemo(() => {
    return sessionsData;
  }, [sessionsData]);

  // Canonical sessions used for ALL analytics:
  // - Remove duplicates (videoFilename stable per recording; fallback to content key)
  // - Exclude insufficient-length guarded sessions (should not affect trends/metrics)
  const sessionsCanonical = useMemo(() => {
    const seen = new Set<string>();
    // sessions are oldest->newest; keep the first occurrence (oldest) for stability
    return sessions.filter((s: any) => {
      if (isInsufficientSpeechSession(s)) return false;
      const key = s.videoFilename || `${s.theme}-${s.quote}-${String(s.transcript || '').substring(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [sessions]);

  // List should show newest first
  const sessionsForList = useMemo(() => {
    return [...sessionsCanonical].reverse();
  }, [sessionsCanonical]);

  // Helper: Get Avg Score
  const getSessionAvgScore = (session: any): number => {
    if (session.overallScore !== undefined) return Number(session.overallScore);
    // Fallback logic
    if (session.contentScore !== undefined && session.deliveryScore !== undefined && session.languageScore !== undefined) {
      return Number(((session.contentScore * 0.4) + (session.deliveryScore * 0.3) + (session.languageScore * 0.15) + (session.bodyLanguageScore || 0) * 0.15).toFixed(1));
    }
    return 0;
  };

  // 1. Calculate Aggregates
  const totalSessions = sessionsCanonical.length;
  const scores = sessionsCanonical.map(getSessionAvgScore);
  const averageScore = totalSessions > 0 ? scores.reduce((a, b) => a + b, 0) / totalSessions : 0;
  
  // 2. Metric: Consistency (Based on Std Dev)
  const stdDev = calculateStdDev(scores);
  let consistencyScore = Math.max(0, Math.min(100, Math.round(100 - (stdDev * 20)))); 
  let consistencyLabel = "LOW";
  let consistencyColor = "#dc2626"; // red
  if (consistencyScore >= 85) { consistencyLabel = "HIGH"; consistencyColor = "#059669"; } // green
  else if (consistencyScore >= 70) { consistencyLabel = "MED-HIGH"; consistencyColor = "#059669"; }
  else if (consistencyScore >= 55) { consistencyLabel = "MEDIUM"; consistencyColor = "#d97706"; } // yellow
  else if (isNaN(consistencyScore)) { consistencyScore = 0; consistencyLabel = "-"; consistencyColor = "#9ca3af"; }

  // 3. Metric: Avg Duration
  const avgDurationSecs = totalSessions > 0 
    ? sessionsCanonical.reduce((sum, s) => sum + (getSessionDuration(s) || 0), 0) / totalSessions 
    : 0;
  const isDurationShort = avgDurationSecs < 180;

  // 4. Metric: Training Frequency
  const firstSessionTime = sessionsCanonical.length > 0 ? sessionsCanonical[0].createdAt : Date.now();
  const weeksActive = Math.max(1, (Date.now() - firstSessionTime) / (1000 * 60 * 60 * 24 * 7));
  const sessionsPerWeek = totalSessions / weeksActive;
  let freqLabel = "LOW";
  let freqColor = "#dc2626";
  if (sessionsPerWeek >= 4) { freqLabel = "EXCELLENT"; freqColor = "#059669"; }
  else if (sessionsPerWeek >= 2.5) { freqLabel = "GOOD"; freqColor = "#059669"; }
  else if (sessionsPerWeek >= 1.0) { freqLabel = "FAIR"; freqColor = "#d97706"; }

  // 5. Metric: Avg Pace
  const avgWpm = totalSessions > 0
    ? sessionsCanonical.reduce((sum, s) => sum + (s.wpm || s.wordsPerMinute || 0), 0) / totalSessions
    : 0;
  const isPaceBad = avgWpm < 120 || avgWpm > 180;

  // 6. Metric: Filler Words / Min
  const avgFillersPerMin = totalSessions > 0
    ? sessionsCanonical.reduce((sum, s) => {
        const durMin = Math.max(0.5, (getSessionDuration(s) || 0) / 60);
        return sum + ((s.fillerCount || 0) / durMin);
      }, 0) / totalSessions
    : 0;
  const isFillersGood = avgFillersPerMin < 5;

  // 7. Metric: Structure Score (Content Avg)
  const avgContentScore = totalSessions > 0
    ? sessionsCanonical.reduce((sum, s) => sum + (s.contentScore || 0), 0) / totalSessions
    : 0;
  const isStructureWeak = avgContentScore < 6.0;

  // Tournament Readiness Logic
  let tierName = "DEVELOPING";
  let tierColor = "#9ca3af"; // Gray
  let tierGradient = "linear-gradient(135deg, #f3f4f6 0%, #ffffff 100%)";
  let tierTextColor = "#374151";

  let nextTier = "Local";
  let nextThreshold = "5.0";
  let recommendations = [
    "Focus on basic structure",
    "Speak for at least 3 minutes",
    "Practice weekly"
  ];

  if (averageScore >= 9.0) {
    tierName = "FINALS";
    tierColor = "#059669"; // Green
    tierGradient = "linear-gradient(135deg, #ecfdf5 0%, #ffffff 100%)";
    tierTextColor = "#065f46";
    nextTier = ""; // Reached top
    recommendations = [
      "Maintain excellence",
      "Maintain consistency",
      "Continue weekly practice",
      "Focus on advanced techniques"
    ];
  } else if (averageScore >= 8.0) {
    tierName = "SEMIFINALS";
    tierColor = "#2563eb"; // Blue
    tierGradient = "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)";
    tierTextColor = "#1e40af";
    nextTier = "Finals";
    nextThreshold = "9.0";
    recommendations = [
      "Refine vocal delivery and pacing",
      "Strengthen evidence and examples",
      "Practice 2-3 per week"
    ];
  } else if (averageScore >= 6.5) {
    tierName = "QUARTERFINALS";
    tierColor = "#ca8a04"; // Yellow/Dark Gold
    tierGradient = "linear-gradient(135deg, #fefce8 0%, #ffffff 100%)";
    tierTextColor = "#854d0e";
    nextTier = "Semifinals";
    nextThreshold = "8.0";
    recommendations = [
      "Improve argument structure",
      "Increase speech length to 5+ minutes",
      "Practice 3-4 per week"
    ];
  } else if (averageScore >= 5.0) {
    tierName = "LOCAL ROUND";
    tierColor = "#7c3aed"; // Purple
    tierGradient = "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)";
    tierTextColor = "#5b21b6";
    nextTier = "Quarterfinals";
    nextThreshold = "6.5";
  }

  // Priority Improvements Logic (Detailed Aggregation)
  const priorityList = useMemo(() => {
    const counts: Record<string, { count: number; impact: string; action: string; originalTitle: string }> = {};

    sessionsCanonical.forEach(s => {
      let analysis: any = s.fullAnalysisJson;
      // Handle stringified JSON if necessary
      if (typeof analysis === 'string') {
        try {
          analysis = JSON.parse(analysis);
        } catch (e) {
          analysis = null;
        }
      }

      if (analysis?.priorityImprovements && Array.isArray(analysis.priorityImprovements)) {
        analysis.priorityImprovements.forEach((pi: any) => {
          if (!pi) return;
          // Normalize issue text to group similar ones
          const title = pi.issue; 
          if (title) {
             const key = title.toLowerCase().trim();
             if (!counts[key]) {
               counts[key] = { 
                 count: 0, 
                 impact: pi.impact || "No description available.", 
                 action: pi.action || "No specific drill.", 
                 originalTitle: title 
               };
             }
             counts[key].count++;
          }
        });
      }
    });

    // Convert to array and sort by frequency
    const sorted = Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3); // Top 3

    // Fallback logic if too few specific issues found
    if (sorted.length < 3 && totalSessions > 0) {
      if (avgContentScore < 6.0 && !sorted.some(i => i.originalTitle === "Improve argument structure")) {
        sorted.push({
          count: 0,
          impact: "Content score is below average. Structure needs reinforcement.",
          action: "Use the 'State, Explain, Support' framework for every point.",
          originalTitle: "Improve argument structure"
        });
      }
      if (avgWpm < 120 && !sorted.some(i => i.originalTitle === "Increase speaking pace")) {
        sorted.push({
          count: 0,
          impact: "Speaking rate is too slow for competitive standard.",
          action: "Practice speaking with a metronome at 130bpm.",
          originalTitle: "Increase speaking pace"
        });
      }
      if (avgFillersPerMin > 5 && !sorted.some(i => i.originalTitle === "Reduce filler words")) {
        sorted.push({
          count: 0,
          impact: "High frequency of filler words detracts from authority.",
          action: "Pause silently instead of using 'um' or 'uh'.",
          originalTitle: "Reduce filler words"
        });
      }
    }

    return sorted.slice(0, 3);
  }, [sessionsCanonical, avgContentScore, avgWpm, avgFillersPerMin, totalSessions]);


  // Chart Data Preparation
  const chartData = sessionsCanonical.map((s, i) => ({
    session: i + 1,
    score: getSessionAvgScore(s),
  }));

  const improvementSinceStart = scores.length > 1 ? scores[scores.length - 1] - scores[0] : 0;
  const improvementSign = improvementSinceStart > 0 ? '+' : '';
  const improvementColor = improvementSinceStart > 0 ? '#059669' : improvementSinceStart < 0 ? '#dc2626' : '#6b7280';

  // ===========================================
  // RENDER HELPERS
  // ===========================================
  
  const MetricCard = ({ label, value, statusLabel, statusColor }: any) => (
    <div className="metric-card" style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      {statusLabel && (
        <div style={{ ...styles.metricStatus, color: statusColor }}>
          {statusLabel}
        </div>
      )}
    </div>
  );

  // Loading Skeleton
  if (isLoading) {
    return (
      <div className="history-page" style={styles.container}>
        <div style={{marginBottom: 20}}>
          <div className="skeleton-pulse" style={{height: 40, width: '40%', background: '#e5e7eb', margin: '0 auto 8px', borderRadius: 8}}></div>
          <div className="skeleton-pulse" style={{height: 20, width: '20%', background: '#e5e7eb', margin: '0 auto', borderRadius: 8}}></div>
        </div>
        
        <div className="metrics-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton-pulse" style={{height: 140, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12}}></div>
          ))}
        </div>

        <div className="skeleton-pulse" style={{height: 200, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, marginBottom: 8}}></div>
        <div className="skeleton-pulse" style={{height: 400, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16, marginBottom: 8}}></div>
        
        <div className="bottom-section">
           <div className="left-column skeleton-pulse" style={{height: 300, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12}}></div>
           <div className="right-column skeleton-pulse" style={{height: 500, background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12}}></div>
        </div>

        <style>{`
           .history-page { padding: 6px; max-width: 1280px; margin: 0 auto; }
           .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
           @media (max-width: 1024px) { .metrics-grid { grid-template-columns: repeat(2, 1fr); } }
           .bottom-section { display: flex; gap: 8px; }
           @media (max-width: 768px) { .bottom-section { flex-direction: column; } .left-column, .right-column { width: 100%; } }
           .left-column { width: 40%; }
           .right-column { width: 60%; }
           .skeleton-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
           @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `}</style>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif'}}>
        <h2 style={{color: '#dc2626', marginBottom: 8}}>Failed to load history</h2>
        <p style={{color: '#6b7280', marginBottom: 24}}>There was a problem connecting to the database.</p>
        <div style={{display: 'flex', gap: 12}}>
            <button onClick={() => window.location.reload()} style={{...styles.backButton, background: '#000', color: '#fff', padding: '8px 16px', borderRadius: 6}}>Retry</button>
            <button onClick={onClose} style={{...styles.backButton, border: '1px solid #e5e7eb', padding: '8px 16px', borderRadius: 6}}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} className="history-page">
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTopRow}>
           <button onClick={onClose} style={styles.backButton} className="hover-link">← Back to Dashboard</button>
        </div>
        <h1 style={styles.title}>Performance History</h1>
        <p style={styles.subtitle}>Detailed analysis of your competitive progress</p>
      </div>

      {/* TOP SECTION: METRICS GRID */}
      <div className="metrics-grid">
        <MetricCard 
          label="CONSISTENCY" 
          value={`${consistencyScore}%`} 
          statusLabel={consistencyLabel}
          statusColor={consistencyColor}
        />
        <MetricCard 
          label="AVG DURATION" 
          value={formatDuration(avgDurationSecs)}
          statusLabel={isDurationShort ? "TOO SHORT" : "OPTIMAL"}
          statusColor={isDurationShort ? "#dc2626" : "#059669"}
        />
        <MetricCard 
          label="TRAINING FREQ" 
          value={`${sessionsPerWeek.toFixed(1)}/wk`}
          statusLabel={freqLabel}
          statusColor={freqColor}
        />
        <MetricCard 
          label="AVG PACE" 
          value={`${Math.round(avgWpm)} WPM`}
          statusLabel={isPaceBad ? (avgWpm < 120 ? "TOO SLOW" : "TOO FAST") : "OPTIMAL"}
          statusColor={isPaceBad ? "#ca8a04" : "#059669"}
        />
        <MetricCard 
          label="FILLER WORDS" 
          value={`${avgFillersPerMin.toFixed(1)}/min`}
          statusLabel={isFillersGood ? "GOOD" : "NEEDS WORK"}
          statusColor={isFillersGood ? "#059669" : "#ca8a04"}
        />
        <MetricCard 
          label="STRUCTURE SCORE" 
          value={avgContentScore.toFixed(1)}
          statusLabel={isStructureWeak ? "WEAK" : "SOLID"}
          statusColor={isStructureWeak ? "#ca8a04" : "#059669"}
        />
      </div>

      {/* TOURNAMENT READINESS CARD (SLEEK VERSION) */}
      <div className="readiness-card major-section" style={{...styles.readinessCard, background: tierGradient}}>
         <div style={styles.readinessContent}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20}}>
               <div>
                  <div style={{fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: tierTextColor, marginBottom: 4}}>CURRENT TIER</div>
                  <div style={{fontSize: '2rem', fontWeight: 800, color: '#111827', lineHeight: 1}}>{tierName}</div>
                  <div style={{fontSize: '0.9rem', color: '#6b7280', marginTop: 4}}>Based on {totalSessions} session average</div>
               </div>
               <div style={{textAlign: 'right'}}>
                  <div style={{fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: '#9ca3af', marginBottom: 4}}>AVERAGE SCORE</div>
                  <div style={{fontSize: '3rem', fontWeight: 800, color: '#111827', lineHeight: 0.9}}>{averageScore.toFixed(1)}</div>
               </div>
            </div>

            <div style={{display: 'flex', gap: 24, flexWrap: 'wrap'}}>
               <div style={{flex: 1, minWidth: '280px'}}>
                  {averageScore < 8.0 ? (
                    <div style={{marginBottom: 16}}>
                      <div style={{fontSize: '0.9rem', fontWeight: 700, color: '#374151', marginBottom: 4}}>PATH TO {nextTier.toUpperCase()}</div>
                      <div style={{height: 8, background: 'rgba(0,0,0,0.05)', borderRadius: 4, overflow: 'hidden', marginBottom: 8}}>
                         <div style={{height: '100%', width: `${(averageScore / 10) * 100}%`, background: tierColor}}></div>
                      </div>
                      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#6b7280'}}>
                         <span>Current: {averageScore.toFixed(1)}</span>
                         <span>Target: {nextThreshold}+</span>
                         <span style={{color: '#2563eb', fontWeight: 600}}>Gap: {(Number(nextThreshold) - averageScore).toFixed(1)}</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{color: '#059669', fontWeight: 700, fontSize: '1.1rem', marginBottom: 16}}>
                       🏆 You are at the top of your game!
                    </div>
                  )}
               </div>

               <div style={{flex: 1.2, minWidth: '280px', background: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: 16, border: '1px solid rgba(0,0,0,0.05)'}}>
                  <div style={{fontSize: '0.75rem', fontWeight: 800, color: '#9ca3af', letterSpacing: '0.05em', marginBottom: 12, textTransform: 'uppercase'}}>Recommended Focus</div>
                  <ul style={{margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px'}}>
                    {recommendations.map((rec, i) => (
                      <li key={i} style={{fontSize: '0.9rem', color: '#4b5563', display: 'flex', alignItems: 'flex-start', gap: 6}}>
                         <span style={{color: tierColor, fontWeight: 'bold'}}>•</span> {rec}
                      </li>
                    ))}
                  </ul>
               </div>
            </div>
         </div>
      </div>

      {/* PERFORMANCE TRENDS CHART */}
      <div style={styles.chartCard} className="chart-card major-section">
        <div style={styles.chartTitle}>PERFORMANCE TRENDS</div>
        <div style={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis 
                dataKey="session" 
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                label={{ value: 'Session #', position: 'insideBottom', offset: -5, fontSize: 12, fill: '#9ca3af' }}
                dy={10}
              />
              <YAxis 
                domain={[0, 10]}
                ticks={[0, 2, 4, 6, 8, 10]}
                tick={{ fontSize: 12, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                label={{ value: 'Score', angle: -90, position: 'insideLeft', fontSize: 12, fill: '#9ca3af' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb', 
                  borderRadius: '8px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                  fontSize: '14px'
                }}
                itemStyle={{ color: '#111827', fontWeight: 600 }}
                labelStyle={{ color: '#6b7280', marginBottom: '4px' }}
                formatter={(value: any) => [`${Number(value)}`, 'Overall Score']}
                labelFormatter={(label) => `Session ${label}`}
              />
              <Line 
                type="monotone" 
                dataKey="score" 
                stroke="#000000" 
                strokeWidth={2.5}
                dot={{ r: 5, fill: '#000000', strokeWidth: 0 }}
                activeDot={{ r: 7, fill: '#000000', strokeWidth: 0 }}
                isAnimationActive={true}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* BOTTOM SECTION: 2-COL LAYOUT */}
      <div className="bottom-section">
        
        {/* Left Column (40%): Sticky Improvements & Progress */}
        <div className="left-column sticky-column">
          
          {/* Priority Improvements */}
          <h3 style={styles.sectionTitle}>PRIORITY IMPROVEMENTS</h3>
          <div style={{...styles.priorityCard, marginBottom: 16}}>
             <div style={styles.priorityList}>
              {priorityList.map((item, i) => (
                <div 
                  key={i} 
                  style={{
                    ...styles.priorityItem,
                    borderBottom: i === priorityList.length - 1 ? 'none' : '1px solid #f3f4f6',
                    paddingBottom: i === priorityList.length - 1 ? 0 : '16px',
                    marginBottom: i === priorityList.length - 1 ? 0 : '16px'
                  }}
                >
                  <div style={styles.priorityHeader}>
                     <span style={styles.priorityRank}>#{i + 1}</span>
                     <span style={styles.priorityTitle}>{item.originalTitle}</span>
                     {item.count > 0 && (
                       <span style={styles.priorityFrequency}>(in {item.count} sessions)</span>
                     )}
                  </div>
                  <div style={styles.priorityDescription}>{item.impact}</div>
                  <div style={styles.priorityAction}>
                     <span style={{fontWeight: 500}}>Drill:</span> {item.action}
                  </div>
                </div>
              ))}
              {priorityList.length === 0 && (
                <div style={styles.emptyState}>No recurring issues detected.</div>
              )}
             </div>
          </div>

          {/* New Progress Stats Card */}
          <h3 style={styles.sectionTitle}>PROGRESS SNAPSHOT</h3>
          <div style={styles.progressCard}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f3f4f6', paddingBottom: 16}}>
                 <span style={{fontSize: '0.85rem', fontWeight: 700, color: '#6b7280'}}>TOTAL IMPROVEMENT</span>
                 <span style={{fontSize: '1.5rem', fontWeight: 800, color: improvementColor}}>
                    {improvementSign}{improvementSinceStart.toFixed(1)}
                 </span>
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
                 <div>
                    <div style={{fontSize: '0.75rem', color: '#9ca3af', marginBottom: 2}}>STARTING SCORE</div>
                    <div style={{fontSize: '1.25rem', fontWeight: 700, color: '#374151'}}>{scores.length > 0 ? scores[0].toFixed(1) : '-'}</div>
                 </div>
                 <div style={{color: '#d1d5db', fontSize: '1.25rem'}}>→</div>
                 <div style={{textAlign: 'right'}}>
                    <div style={{fontSize: '0.75rem', color: '#9ca3af', marginBottom: 2}}>CURRENT AVG</div>
                    <div style={{fontSize: '1.25rem', fontWeight: 700, color: '#111827'}}>{averageScore.toFixed(1)}</div>
                 </div>
              </div>
          </div>

        </div>

        {/* Right Column (60%): Recent Rounds */}
        <div className="right-column">
          <h3 style={styles.sectionTitle}>RECENT ROUNDS</h3>
          
          {sessionsForList.length > 0 ? (
            <div style={styles.sessionsList} className="sessions-list">
              {sessionsForList.map((session: any) => {
                const score = getSessionAvgScore(session);
                const scoreColor = score >= 6.0 ? '#059669' : score >= 4.0 ? '#ca8a04' : '#dc2626';
                const dateStr = formatDate(session.createdAt);
                
                // Stats
                const wpm = session.wpm || session.wordsPerMinute || 0;
                const duration = getSessionDuration(session);
                
                // Warnings
                const warnings = [];
                if (duration < 180 && duration > 0) warnings.push("Too short");
                if (score < 4.0) warnings.push("Low performance");

                return (
                  <div 
                    key={session.id} 
                    style={styles.roundCard}
                    onClick={() => onSelectSession && onSelectSession(session)}
                    className="round-card"
                  >
                    <div style={styles.roundCardContent}>
                      {/* Left Side: Score & Meta */}
                      <div style={styles.roundLeft}>
                        <div style={{ ...styles.roundScore, color: scoreColor }}>{score}</div>
                        <div style={styles.roundMeta}>
                          <div style={styles.roundTheme}>{session.theme || 'Unknown Theme'}</div>
                          <div style={styles.roundDate}>{dateStr}</div>
                        </div>
                      </div>

                      {/* Right Side: Arrow */}
                      <div style={styles.roundArrow} className="round-arrow">
                         <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                           <line x1="5" y1="12" x2="19" y2="12"></line>
                           <polyline points="12 5 19 12 12 19"></polyline>
                         </svg>
                      </div>
                    </div>

                    {/* Below Header: Stats */}
                    <div style={styles.roundStats}>
                       <span>{Math.round(wpm)} WPM</span>
                       <span style={styles.statSeparator}>•</span>
                       <span>{formatDuration(duration)}</span>
                    </div>

                    {/* Category Scores */}
                    <div style={styles.roundCats}>
                       <span>Content {session.contentScore || '-'}</span>
                       <span>Delivery {session.deliveryScore || '-'}</span>
                       <span>Language {session.languageScore || '-'}</span>
                       <span>Body {session.bodyLanguageScore || '-'}</span>
                    </div>

                    {/* Warnings */}
                    {warnings.length > 0 && (
                      <div style={styles.roundWarnings}>
                         {warnings.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyState}>No sessions yet.</div>
          )}
        </div>
      </div>
      
      {/* Responsive Styles Injection */}
      <style>{`
        /* TRANSITIONS & INTERACTION */
        .metric-card, .round-card, button, a, .readiness-badge {
          transition: all 200ms ease;
        }
        
        .hover-link:hover {
          color: #111827 !important;
          text-decoration: underline;
        }

        .round-card:hover {
           background-color: #f9fafb !important;
           border-color: #9ca3af !important;
        }
        .round-card:hover .round-arrow {
           transform: translateX(4px);
           color: #111827 !important;
        }

        /* PAGE CONTAINER */
        .history-page {
          padding: 6px;
          max-width: 1280px;
          margin: 0 auto;
        }
        @media (max-width: 768px) {
          .history-page { padding: 4px; }
        }

        /* SPACING */
        .major-section {
          margin-bottom: 8px; /* Strict 8px spacing */
        }
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px; /* Strict 6px gap */
          margin-bottom: 8px;
        }
        
        /* STICKY COLUMN */
        .sticky-column {
           position: sticky;
           top: 20px;
           height: fit-content;
        }
        
        /* TABLET */
        @media (min-width: 768px) and (max-width: 1023px) {
          .metrics-grid { grid-template-columns: repeat(2, 1fr); }
          .bottom-section { gap: 6px; }
        }

        /* MOBILE */
        @media (max-width: 768px) {
          .metrics-grid { grid-template-columns: repeat(2, 1fr); }
          
          .readiness-card { flex-direction: column; }
          .readiness-content { padding: 16px !important; }
          
          .bottom-section { flex-direction: column; gap: 8px; }
          .left-column, .right-column { width: 100% !important; }
          
          /* Disable sticky on mobile as columns stack */
          .sticky-column { position: static; }
        }

        /* LAYOUT COLUMNS */
        .bottom-section {
           display: flex;
           gap: 8px;
           margin-top: 8px;
        }
        .left-column { width: 40%; }
        .right-column { width: 60%; }
      `}</style>
    </div>
  );
}

// ===========================================
// STYLES
// ===========================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#ffffff',
    fontFamily: "'Segoe UI', Roboto, sans-serif",
  },
  header: {
    marginBottom: '24px',
    textAlign: 'center',
    padding: '20px 0',
    position: 'relative',
  },
  headerTopRow: {
    position: 'absolute',
    top: '20px',
    left: '0',
    display: 'flex',
    alignItems: 'center',
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
    display: 'inline-block',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#111827',
    margin: '0 0 4px 0',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '1rem',
    margin: 0,
  },
  
  metricCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    minHeight: '120px',
    gap: '4px',
  },
  metricLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#6b7280',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#111827',
    margin: '4px 0',
  },
  metricStatus: {
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  readinessCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
  readinessContent: {
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
  },

  chartCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
  chartTitle: {
    fontSize: '0.9rem',
    fontWeight: 800,
    color: '#111827',
    marginBottom: '20px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  chartContainer: {
    width: '100%',
    height: '320px',
  },

  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: 800,
    color: '#111827',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  
  priorityCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
  priorityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  priorityItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  priorityHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap',
  },
  priorityRank: {
    fontSize: '0.9rem',
    fontWeight: 800,
    color: '#111827',
  },
  priorityTitle: {
    fontSize: '0.95rem',
    fontWeight: 800,
    color: '#111827',
  },
  priorityFrequency: {
    fontSize: '0.8rem',
    color: '#9ca3af',
  },
  priorityDescription: {
    fontSize: '0.85rem',
    color: '#6b7280',
    lineHeight: 1.4,
  },
  priorityAction: {
    fontSize: '0.85rem',
    color: '#2563eb',
  },
  emptyState: {
    color: '#9ca3af',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '20px',
    fontSize: '0.9rem',
  },

  progressCard: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },

  sessionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  roundCard: {
    background: '#ffffff',
    borderRadius: '12px',
    padding: '16px',
    cursor: 'pointer',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
  roundCardContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  roundLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  roundScore: {
    fontSize: '1.5rem',
    fontWeight: 800,
    lineHeight: 1,
  },
  roundMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  roundTheme: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: '#111827',
  },
  roundDate: {
    fontSize: '0.75rem',
    color: '#9ca3af',
  },
  roundArrow: {
    color: '#9ca3af',
  },
  roundStats: {
    fontSize: '0.8rem',
    color: '#6b7280',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  statSeparator: {
    color: '#d1d5db',
  },
  roundCats: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  roundWarnings: {
    fontSize: '0.75rem',
    color: '#dc2626',
    fontWeight: 600,
    marginTop: '6px',
  },
};

export default History;
