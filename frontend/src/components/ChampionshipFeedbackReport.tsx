/**
 * ChampionshipFeedbackReport Component
 * 
 * Displays championship-grade, evidence-heavy, actionable judging feedback.
 * 
 * Layout:
 * - Left: Main content (Quote, RFD, Evidence, Levers, etc.)
 * - Right: Sticky sidebar with score summary + section navigation
 * 
 * Design: Clean black/white/gray theme
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { 
  ChampionshipAnalysis, 
  ChampionshipEvidence, 
  ChampionshipLever,
  ChampionshipMicroRewrite 
} from '../types';

// ===========================================
// PROPS
// ===========================================

interface ChampionshipFeedbackReportProps {
  analysis: ChampionshipAnalysis;
  theme: string;
  quote: string;
  transcript: string;
  videoFilename: string;
  isMock?: boolean;
  onRedoRound: () => void;
  onNewRound: () => void;
  onGoHome: () => void;
  backLabel?: string;
  readOnly?: boolean;
}

// ===========================================
// SECTION IDS FOR NAVIGATION
// ===========================================

const SECTION_IDS = {
  rfd: 'section-rfd',
  evidence: 'section-evidence',
  levers: 'section-levers',
  rewrites: 'section-rewrites',
  delivery: 'section-delivery',
  checklist: 'section-checklist',
  transcript: 'section-transcript',
};

// ===========================================
// HELPER COMPONENTS
// ===========================================

/** Section header with black band */
const SectionHeader = ({ 
  title, 
  isOpen, 
  onToggle,
  badge,
}: { 
  title: string; 
  isOpen: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
}) => {
  return (
    <button 
      onClick={onToggle} 
      style={styles.sectionHeader}
    >
      <div style={styles.sectionHeaderLeft}>
        <span style={styles.sectionTitle}>{title}</span>
        {badge}
      </div>
      <span style={styles.sectionToggle}>{isOpen ? '−' : '+'}</span>
    </button>
  );
};

/** Collapsible section wrapper with black band header */
const CollapsibleSection = ({ 
  title, 
  defaultOpen = false, 
  children,
  badge,
  id,
}: { 
  title: string; 
  defaultOpen?: boolean; 
  children: React.ReactNode;
  badge?: React.ReactNode;
  id?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div id={id} style={{ ...styles.section, scrollMarginTop: '80px' }}>
      <SectionHeader 
        title={title} 
        isOpen={isOpen} 
        onToggle={() => setIsOpen(!isOpen)}
        badge={badge}
      />
      {isOpen && <div style={styles.sectionContent}>{children}</div>}
    </div>
  );
};

/** Evidence item display */
const EvidenceItem = ({ evidence }: { evidence: ChampionshipEvidence }) => {
  const isStrength = evidence.label === 'STRENGTH';
  
  return (
    <div style={{
      ...styles.evidenceItem,
      borderLeft: `3px solid ${isStrength ? '#111' : '#9ca3af'}`,
    }}>
      <div style={styles.evidenceHeader}>
        <span style={{
          ...styles.evidenceLabel,
          background: isStrength ? '#111' : '#e5e7eb',
          color: isStrength ? '#fff' : '#374151',
        }}>
          {evidence.label}
        </span>
        <span style={styles.evidenceId}>{evidence.id}</span>
      </div>
      
      {evidence.type === 'QUOTE' && evidence.quote && (
        <div style={styles.quoteBox}>
          <span style={styles.quoteText}>"{evidence.quote}"</span>
          {evidence.timeRange && (
            <span style={styles.timeRange}>{evidence.timeRange}</span>
          )}
        </div>
      )}
      
      {evidence.type === 'METRIC' && evidence.metric && (
        <div style={styles.metricBox}>
          <span style={styles.metricName}>{evidence.metric.name}</span>
          <span style={styles.metricValue}>
            {evidence.metric.value} {evidence.metric.unit}
          </span>
        </div>
      )}
      
      <p style={styles.warrant}>{evidence.warrant}</p>
    </div>
  );
};

/** Lever (ranked fix) display */
const LeverItem = ({ lever, isExpanded, onToggle }: { 
  lever: ChampionshipLever; 
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  return (
    <div style={styles.leverCard}>
      <button onClick={onToggle} style={styles.leverHeader}>
        <div style={styles.leverHeaderLeft}>
          <span style={styles.leverRank}>#{lever.rank}</span>
          <span style={styles.leverName}>{lever.name}</span>
          <span style={styles.scoreGain}>{lever.estimatedScoreGain}</span>
        </div>
        <span style={styles.leverToggle}>{isExpanded ? '−' : '+'}</span>
      </button>
      
      {isExpanded && (
        <div style={styles.leverBody}>
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Pattern</div>
            <span style={styles.patternBadge}>{lever.patternName}</span>
          </div>
          
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Diagnosis</div>
            <p style={styles.leverText}>{lever.diagnosis}</p>
          </div>
          
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Judge Impact</div>
            <p style={styles.leverText}>{lever.judgeImpact}</p>
          </div>
          
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Fix Rule</div>
            <p style={styles.fixRule}>{lever.fixRule}</p>
          </div>
          
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Say This Instead</div>
            <div style={styles.sayThisBox}>
              {lever.sayThisInstead.map((line, i) => (
                <div key={i} style={styles.sayThisLine}>
                  <span style={styles.sayThisNumber}>{i + 1}</span>
                  <span style={styles.sayThisText}>"{line}"</span>
                </div>
              ))}
            </div>
          </div>
          
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Coach Questions</div>
            <ul style={styles.coachQuestions}>
              {lever.coachQuestions.map((q, i) => (
                <li key={i} style={styles.coachQuestion}>{q}</li>
              ))}
            </ul>
          </div>
          
          <div style={styles.leverSection}>
            <div style={styles.leverSectionLabel}>Practice Drill: {lever.drill.name}</div>
            <ol style={styles.drillSteps}>
              {lever.drill.steps.map((step, i) => (
                <li key={i} style={styles.drillStep}>{step}</li>
              ))}
            </ol>
            <div style={styles.drillGoal}>
              <strong>Goal:</strong> {lever.drill.goal}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Micro-rewrite display */
const MicroRewriteItem = ({ rewrite }: { rewrite: ChampionshipMicroRewrite }) => {
  return (
    <div style={styles.rewriteCard}>
      <div style={styles.rewriteBefore}>
        <div style={styles.rewriteLabel}>BEFORE</div>
        <div style={styles.rewriteQuote}>
          "{rewrite.before.quote}"
          {rewrite.before.timeRange && (
            <span style={styles.timeRange}>{rewrite.before.timeRange}</span>
          )}
        </div>
      </div>
      <div style={styles.rewriteArrow}>→</div>
      <div style={styles.rewriteAfter}>
        <div style={styles.rewriteLabel}>AFTER</div>
        <div style={styles.rewriteText}>{rewrite.after}</div>
      </div>
      <div style={styles.rewriteWhy}>
        <strong>Why stronger:</strong> {rewrite.whyStronger}
      </div>
    </div>
  );
};

// ===========================================
// MAIN COMPONENT
// ===========================================

export default function ChampionshipFeedbackReport({
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
}: ChampionshipFeedbackReportProps) {
  const [expandedLever, setExpandedLever] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const savedRef = useRef(false);

  // Generate session hash for deduplication
  const sessionId = useMemo(() => {
    const content = `${theme}-${quote}-${transcript.substring(0, 200)}-${videoFilename}`;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }, [theme, quote, transcript, videoFilename]);

  // Save session to Supabase
  useEffect(() => {
    const stableKey = videoFilename ? `video_${videoFilename}` : `hash_${sessionId}`;
    const saveKey = `saved_session_${stableKey}`;
    
    if (savedRef.current || sessionStorage.getItem(saveKey) || readOnly || isMock) {
      return;
    }
    
    savedRef.current = true;
    sessionStorage.setItem(saveKey, 'true');

    const client = supabase;
    if (!client) return;

    const saveSession = async () => {
      try {
        const { data: { user } } = await client.auth.getUser();
        if (!user) {
          savedRef.current = false;
          sessionStorage.removeItem(saveKey);
          return;
        }

        await client.from('sessions').insert({
          user_id: user.id,
          theme,
          quote,
          transcript,
          overall_score: analysis.scoring.overallScore,
          content_score: analysis.scoring.categoryScores.argumentStructure.score,
          delivery_score: null,
          language_score: analysis.scoring.categoryScores.rhetoricLanguage.score,
          body_language_score: null,
          duration: analysis.speechStats.durationText,
          word_count: analysis.speechStats.wordCount,
          wpm: analysis.speechStats.wpm,
          filler_word_count: analysis.speechStats.fillerWordCount,
          performance_tier: analysis.scoring.performanceTier,
          tournament_ready: analysis.scoring.tournamentReady,
          strengths: [],
          practice_drill: analysis.deliveryMetricsCoaching?.drill?.name || '',
          video_filename: videoFilename,
          full_analysis_json: JSON.stringify(analysis),
        });

        console.log('Session saved to Supabase');
      } catch (error) {
        console.error('Failed to save session:', error);
      }
    };

    saveSession();
  }, [sessionId, analysis, theme, quote, transcript, videoFilename, isMock, readOnly]);

  // Separate evidence by label
  const strengths = analysis.evidence?.filter(e => e.label === 'STRENGTH') || [];
  const gaps = analysis.evidence?.filter(e => e.label === 'GAP') || [];

  // Format classification labels nicely (e.g., "too_short" → "Too Short")
  const formatClassificationLabel = (text: string): string => {
    return text
      .replace(/too_short/g, 'Too Short')
      .replace(/mostly_off_topic/g, 'Mostly Off Topic')
      .replace(/off_topic/g, 'Off Topic')
      .replace(/nonsense/g, 'Nonsense');
  };

  // Scroll to section (with offset for sticky header)
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // PDF Export - includes everything
  const handleExportPDF = useCallback(() => {
    setIsExporting(true);
    
    try {
      const pdfContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Round Ballot - ${theme}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; padding: 32px; max-width: 900px; margin: 0 auto; color: #111; font-size: 11px; line-height: 1.5; }
    .header { margin-bottom: 24px; border-bottom: 2px solid #111; padding-bottom: 16px; }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .title { font-size: 24px; font-weight: 800; margin: 0; }
    .tier-badge { background: #111; color: white; padding: 4px 10px; border-radius: 3px; font-size: 10px; font-weight: 700; }
    .quote-box { background: #f9fafb; padding: 12px 16px; border-left: 3px solid #111; margin-bottom: 20px; }
    .quote-theme { font-size: 10px; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .quote-text { font-style: italic; font-size: 13px; }
    
    .scores-row { display: flex; gap: 16px; margin-bottom: 20px; }
    .score-card { flex: 1; background: #f9fafb; padding: 12px; border-radius: 6px; text-align: center; }
    .score-label { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    .score-value { font-size: 28px; font-weight: 800; }
    .score-weight { font-size: 9px; color: #999; }
    
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section-title { background: #111; color: #fff; padding: 8px 12px; font-size: 12px; font-weight: 700; margin-bottom: 0; }
    .section-content { padding: 12px; border: 1px solid #e5e7eb; border-top: none; }
    
    .rfd-text { font-size: 11px; line-height: 1.6; }
    .rfd-subsection { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
    .rfd-subtitle { font-weight: 700; font-size: 10px; margin-bottom: 6px; }
    
    .evidence-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .evidence-col-title { font-weight: 700; font-size: 10px; margin-bottom: 8px; }
    .evidence-item { background: #f9fafb; padding: 8px; border-radius: 4px; margin-bottom: 6px; border-left: 2px solid #111; }
    .evidence-label { font-size: 8px; font-weight: 700; background: #111; color: #fff; padding: 1px 4px; border-radius: 2px; }
    .evidence-quote { font-style: italic; font-size: 10px; margin: 6px 0; }
    .evidence-warrant { font-size: 10px; color: #4b5563; }
    
    .lever { background: #f9fafb; padding: 10px; border-radius: 4px; margin-bottom: 8px; }
    .lever-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .lever-rank { background: #111; color: #fff; padding: 2px 6px; border-radius: 2px; font-size: 9px; font-weight: 700; }
    .lever-name { font-weight: 700; font-size: 11px; }
    .lever-gain { background: #e5e7eb; padding: 2px 4px; border-radius: 2px; font-size: 9px; }
    .lever-section { margin-top: 8px; }
    .lever-label { font-size: 9px; font-weight: 700; color: #666; text-transform: uppercase; }
    .lever-text { font-size: 10px; margin: 4px 0 0 0; }
    .fix-rule { background: #fff; border-left: 2px solid #111; padding: 6px 8px; font-size: 10px; font-weight: 600; }
    
    .rewrite { background: #f9fafb; padding: 10px; border-radius: 4px; margin-bottom: 8px; }
    .rewrite-label { font-size: 8px; font-weight: 700; color: #666; text-transform: uppercase; }
    .rewrite-before { background: #fff; padding: 6px; border-radius: 3px; font-style: italic; font-size: 10px; color: #666; margin: 4px 0; }
    .rewrite-after { background: #fff; padding: 6px; border-radius: 3px; font-size: 10px; font-weight: 500; margin: 4px 0; border-left: 2px solid #111; }
    .rewrite-why { font-size: 10px; color: #4b5563; margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb; }
    
    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
    .metric { background: #111; color: #fff; padding: 10px; border-radius: 4px; text-align: center; }
    .metric-value { font-size: 16px; font-weight: 800; }
    .metric-label { font-size: 8px; color: #9ca3af; }
    
    .checklist-item { display: flex; gap: 8px; background: #f9fafb; padding: 8px; border-radius: 4px; margin-bottom: 6px; border-left: 2px solid #111; }
    .checklist-step { background: #111; color: #fff; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
    .checklist-instruction { font-weight: 600; font-size: 10px; }
    .checklist-success { font-size: 9px; color: #666; }
    
    .checklist-extras { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
    .checklist-extra { background: #f9fafb; padding: 8px; border-radius: 4px; }
    .checklist-extra-title { font-weight: 700; font-size: 9px; margin-bottom: 6px; }
    .checklist-extra ul { margin: 0; padding-left: 14px; font-size: 9px; }
    
    .transcript-box { background: #f9fafb; padding: 10px; border-radius: 4px; max-height: none; }
    .transcript-text { font-family: 'SF Mono', Consolas, monospace; font-size: 9px; white-space: pre-wrap; margin: 0; }
    
    .warnings { background: #f9fafb; border: 1px solid #d1d5db; padding: 10px; border-radius: 4px; margin-bottom: 16px; }
    .warnings-title { font-weight: 700; font-size: 10px; margin-bottom: 4px; }
    .warning-item { font-size: 10px; color: #4b5563; }
    
    .footer { margin-top: 24px; text-align: center; font-size: 9px; color: #999; border-top: 1px solid #e5e7eb; padding-top: 12px; }
    
    @media print { 
      body { padding: 16px; } 
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-row">
      <h1 class="title">Round Ballot</h1>
      <span class="tier-badge">${analysis.scoring.performanceTier.toUpperCase()}</span>
    </div>
    <div class="quote-box">
      <div class="quote-theme">Theme: ${theme}</div>
      <div class="quote-text">"${quote}"</div>
    </div>
  </div>

  ${analysis.warnings && analysis.warnings.length > 0 ? `
  <div class="warnings">
    <div class="warnings-title">Warnings</div>
    ${analysis.warnings.map(w => `<div class="warning-item">${w.replace(/too_short/g, 'Too Short').replace(/mostly_off_topic/g, 'Mostly Off Topic').replace(/off_topic/g, 'Off Topic').replace(/nonsense/g, 'Nonsense')}</div>`).join('')}
  </div>
  ` : ''}

  <div class="scores-row">
    <div class="score-card">
      <div class="score-label">Overall</div>
      <div class="score-value">${analysis.scoring.overallScore.toFixed(1)}</div>
      <div class="score-weight">Tournament Ready: ${analysis.scoring.tournamentReady ? 'YES' : 'NO'}</div>
    </div>
    <div class="score-card">
      <div class="score-label">Argument & Structure</div>
      <div class="score-value">${analysis.scoring.categoryScores.argumentStructure.score.toFixed(1)}</div>
      <div class="score-weight">45% weight</div>
    </div>
    <div class="score-card">
      <div class="score-label">Depth & Weighing</div>
      <div class="score-value">${analysis.scoring.categoryScores.depthWeighing.score.toFixed(1)}</div>
      <div class="score-weight">35% weight</div>
    </div>
    <div class="score-card">
      <div class="score-label">Rhetoric & Language</div>
      <div class="score-value">${analysis.scoring.categoryScores.rhetoricLanguage.score.toFixed(1)}</div>
      <div class="score-weight">20% weight</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Reason for Decision (RFD)</div>
    <div class="section-content">
      <div class="rfd-text">${analysis.rfd?.summary || 'No RFD available'}</div>
      ${analysis.rfd?.whyThisScore && analysis.rfd.whyThisScore.length > 0 ? `
        <div class="rfd-subsection">
          <div class="rfd-subtitle">Why This Score</div>
          ${analysis.rfd.whyThisScore.map(item => `
            <p style="margin: 4px 0;">${item.claim} <span style="color: #666; font-size: 9px;">(Evidence: ${item.evidenceIds.join(', ')})</span></p>
          `).join('')}
        </div>
      ` : ''}
      ${analysis.rfd?.whyNotHigher ? `
        <div class="rfd-subsection">
          <div class="rfd-subtitle">Why Not ${analysis.rfd.whyNotHigher.nextBand}?</div>
          ${analysis.rfd.whyNotHigher.blockers.map(b => `
            <p style="margin: 4px 0;">${b.blocker} <span style="color: #666; font-size: 9px;">(Evidence: ${b.evidenceIds.join(', ')})</span></p>
          `).join('')}
        </div>
      ` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Evidence Receipts (${strengths.length} Strengths / ${gaps.length} Gaps)</div>
    <div class="section-content">
      <div class="evidence-grid">
        <div>
          <div class="evidence-col-title">Strengths</div>
          ${strengths.map(e => `
            <div class="evidence-item">
              <span class="evidence-label">${e.label}</span> <span style="font-size: 8px; color: #999;">${e.id}</span>
              ${e.type === 'QUOTE' && e.quote ? `<div class="evidence-quote">"${e.quote}"${e.timeRange ? ` <span style="color: #999;">${e.timeRange}</span>` : ''}</div>` : ''}
              ${e.type === 'METRIC' && e.metric ? `<div style="font-size: 10px; font-weight: 600;">${e.metric.name}: ${e.metric.value} ${e.metric.unit}</div>` : ''}
              <div class="evidence-warrant">${e.warrant}</div>
            </div>
          `).join('')}
        </div>
        <div>
          <div class="evidence-col-title" style="color: #666;">Gaps</div>
          ${gaps.map(e => `
            <div class="evidence-item" style="border-left-color: #9ca3af;">
              <span class="evidence-label" style="background: #e5e7eb; color: #374151;">${e.label}</span> <span style="font-size: 8px; color: #999;">${e.id}</span>
              ${e.type === 'QUOTE' && e.quote ? `<div class="evidence-quote">"${e.quote}"${e.timeRange ? ` <span style="color: #999;">${e.timeRange}</span>` : ''}</div>` : ''}
              ${e.type === 'METRIC' && e.metric ? `<div style="font-size: 10px; font-weight: 600;">${e.metric.name}: ${e.metric.value} ${e.metric.unit}</div>` : ''}
              <div class="evidence-warrant">${e.warrant}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Ranked Levers (${analysis.levers?.length || 0} Improvement Areas)</div>
    <div class="section-content">
      ${(analysis.levers || []).map(lever => `
        <div class="lever">
          <div class="lever-header">
            <span class="lever-rank">#${lever.rank}</span>
            <span class="lever-name">${lever.name}</span>
            <span class="lever-gain">${lever.estimatedScoreGain}</span>
          </div>
          <div class="lever-section">
            <div class="lever-label">Pattern</div>
            <div class="lever-text">${lever.patternName}</div>
          </div>
          <div class="lever-section">
            <div class="lever-label">Diagnosis</div>
            <div class="lever-text">${lever.diagnosis}</div>
          </div>
          <div class="lever-section">
            <div class="lever-label">Judge Impact</div>
            <div class="lever-text">${lever.judgeImpact}</div>
          </div>
          <div class="lever-section">
            <div class="lever-label">Fix Rule</div>
            <div class="fix-rule">${lever.fixRule}</div>
          </div>
          <div class="lever-section">
            <div class="lever-label">Say This Instead</div>
            ${lever.sayThisInstead.map((line, i) => `<div class="lever-text">${i + 1}. "${line}"</div>`).join('')}
          </div>
          <div class="lever-section">
            <div class="lever-label">Practice Drill: ${lever.drill.name}</div>
            <ol style="margin: 4px 0 0 16px; padding: 0; font-size: 10px;">
              ${lever.drill.steps.map(s => `<li>${s}</li>`).join('')}
            </ol>
            <div class="lever-text" style="margin-top: 6px;"><strong>Goal:</strong> ${lever.drill.goal}</div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  ${analysis.microRewrites && analysis.microRewrites.length > 0 ? `
  <div class="section">
    <div class="section-title">Micro-Rewrites (${analysis.microRewrites.length} Copy/Paste Upgrades)</div>
    <div class="section-content">
      ${analysis.microRewrites.map(r => `
        <div class="rewrite">
          <div class="rewrite-label">Before</div>
          <div class="rewrite-before">"${r.before.quote}"${r.before.timeRange ? ` <span style="color: #999;">${r.before.timeRange}</span>` : ''}</div>
          <div class="rewrite-label">After</div>
          <div class="rewrite-after">${r.after}</div>
          <div class="rewrite-why"><strong>Why stronger:</strong> ${r.whyStronger}</div>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Delivery Metrics</div>
    <div class="section-content">
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-value">${analysis.speechStats.wpm}</div>
          <div class="metric-label">WPM</div>
        </div>
        <div class="metric">
          <div class="metric-value">${analysis.speechStats.fillerPerMin.toFixed(1)}</div>
          <div class="metric-label">FILLERS/MIN</div>
        </div>
        <div class="metric">
          <div class="metric-value">${analysis.speechStats.durationText}</div>
          <div class="metric-label">DURATION</div>
        </div>
        <div class="metric">
          <div class="metric-value">${analysis.speechStats.wordCount}</div>
          <div class="metric-label">WORDS</div>
        </div>
      </div>
      ${analysis.deliveryMetricsCoaching?.drill ? `
        <div style="background: #f9fafb; padding: 10px; border-radius: 4px;">
          <div style="font-weight: 700; font-size: 10px; margin-bottom: 6px;">Drill: ${analysis.deliveryMetricsCoaching.drill.name}</div>
          <ol style="margin: 0 0 8px 16px; padding: 0; font-size: 10px;">
            ${analysis.deliveryMetricsCoaching.drill.steps.map(s => `<li>${s}</li>`).join('')}
          </ol>
          <div style="font-size: 10px;"><strong>Goal:</strong> ${analysis.deliveryMetricsCoaching.drill.goal}</div>
        </div>
      ` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Next-Round Checklist</div>
    <div class="section-content">
      ${(analysis.actionPlan?.nextRoundChecklist || []).map(item => `
        <div class="checklist-item">
          <div class="checklist-step">${item.step}</div>
          <div>
            <div class="checklist-instruction">${item.instruction}</div>
            <div class="checklist-success">Success: ${item.successCriteria}</div>
          </div>
        </div>
      `).join('')}
      <div class="checklist-extras">
        <div class="checklist-extra">
          <div class="checklist-extra-title">5-Min Warmup</div>
          <ul>${(analysis.actionPlan?.warmup5Min || []).map(i => `<li>${i}</li>`).join('')}</ul>
        </div>
        <div class="checklist-extra">
          <div class="checklist-extra-title">During Speech Cues</div>
          <ul>${(analysis.actionPlan?.duringSpeechCues || []).map(i => `<li>${i}</li>`).join('')}</ul>
        </div>
        <div class="checklist-extra">
          <div class="checklist-extra-title">Post-Round Review</div>
          <ul>${(analysis.actionPlan?.postRoundReview || []).map(i => `<li>${i}</li>`).join('')}</ul>
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Full Transcript</div>
    <div class="section-content">
      <div class="transcript-box">
        <pre class="transcript-text">${transcript}</pre>
      </div>
    </div>
  </div>

  <div class="footer">
    Generated by WinBallot - ${new Date().toLocaleDateString()}
  </div>
</body>
</html>
      `;
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups to export PDF');
        setIsExporting(false);
        return;
      }
      
      printWindow.document.write(pdfContent);
      printWindow.document.close();
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          setIsExporting(false);
        }, 250);
      };
      
      setTimeout(() => setIsExporting(false), 2000);
    } catch (err) {
      console.error('PDF export error:', err);
      setIsExporting(false);
    }
  }, [analysis, theme, quote, transcript, strengths, gaps]);

  return (
    <div style={styles.container}>
      {/* Back Button */}
      <button onClick={onGoHome} style={styles.backLink}>
        {backLabel}
      </button>

      {/* Main Layout: Left Content + Right Sticky Sidebar */}
      <div style={styles.mainLayout}>
        {/* Left Column - Main Content */}
        <div style={styles.leftColumn}>
          {/* Header with Title */}
          <div style={styles.header}>
            <div style={styles.headerRow}>
              <div style={styles.headerLeft}>
                <span style={styles.tierBadge}>
                  {analysis.scoring.performanceTier.toUpperCase()}
                </span>
                <h1 style={styles.title}>Round Ballot</h1>
              </div>
            </div>
          </div>

          {/* Quote Box at Top */}
          <div style={styles.quoteBoxTop}>
            <div style={styles.quoteTheme}>Theme: {theme}</div>
            <div style={styles.quoteTextTop}>"{quote}"</div>
          </div>

          {/* Warnings (only once) */}
          {analysis.warnings && analysis.warnings.length > 0 && (
            <div style={styles.warningsBox}>
              <div style={styles.warningsTitle}>Warnings</div>
              {analysis.warnings.map((warning, i) => (
                <div key={i} style={styles.warningItem}>{formatClassificationLabel(warning)}</div>
              ))}
            </div>
          )}

          {/* RFD - Default open */}
          <CollapsibleSection 
            title="Reason for Decision (RFD)" 
            defaultOpen={true}
            id={SECTION_IDS.rfd}
          >
            <div style={styles.rfdBox}>
              <p style={styles.rfdSummary}>{analysis.rfd?.summary}</p>
              
              {analysis.rfd?.whyThisScore && analysis.rfd.whyThisScore.length > 0 && (
                <div style={styles.rfdSection}>
                  <div style={styles.rfdSectionTitle}>Why This Score</div>
                  {analysis.rfd.whyThisScore.map((item, i) => (
                    <div key={i} style={styles.rfdClaim}>
                      <p style={{ margin: 0 }}>{item.claim}</p>
                      <div style={styles.evidenceRefs}>
                        Evidence: {item.evidenceIds.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {analysis.rfd?.whyNotHigher && (
                <div style={styles.rfdSection}>
                  <div style={styles.rfdSectionTitle}>
                    Why Not {analysis.rfd.whyNotHigher.nextBand}?
                  </div>
                  {analysis.rfd.whyNotHigher.blockers.map((blocker, i) => (
                    <div key={i} style={styles.rfdBlocker}>
                      <p style={{ margin: 0 }}>{blocker.blocker}</p>
                      <div style={styles.evidenceRefs}>
                        Evidence: {blocker.evidenceIds.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Evidence Receipts */}
          <CollapsibleSection 
            title="Evidence Receipts" 
            defaultOpen={false}
            badge={<span style={styles.badge}>{strengths.length} Strengths / {gaps.length} Gaps</span>}
            id={SECTION_IDS.evidence}
          >
            <div style={styles.evidenceGrid}>
              <div style={styles.evidenceColumn}>
                <div style={styles.evidenceColumnTitle}>Strengths</div>
                {strengths.map((e, i) => (
                  <EvidenceItem key={i} evidence={e} />
                ))}
              </div>
              <div style={styles.evidenceColumn}>
                <div style={styles.evidenceColumnTitle}>Gaps</div>
                {gaps.map((e, i) => (
                  <EvidenceItem key={i} evidence={e} />
                ))}
              </div>
            </div>
          </CollapsibleSection>

          {/* Ranked Levers */}
          <CollapsibleSection 
            title="Ranked Levers (Upgrade Path)"
            defaultOpen={false}
            badge={<span style={styles.badge}>{analysis.levers?.length || 0} levers</span>}
            id={SECTION_IDS.levers}
          >
            <div style={styles.leversContainer}>
              {(analysis.levers || []).map((lever, i) => (
                <LeverItem 
                  key={i} 
                  lever={lever}
                  isExpanded={expandedLever === i}
                  onToggle={() => setExpandedLever(expandedLever === i ? null : i)}
                />
              ))}
            </div>
          </CollapsibleSection>

          {/* Micro-Rewrites */}
          {analysis.microRewrites && analysis.microRewrites.length > 0 && (
            <CollapsibleSection 
              title="Micro-Rewrites (Copy/Paste Upgrades)" 
              defaultOpen={false}
              id={SECTION_IDS.rewrites}
            >
              <div style={styles.rewritesContainer}>
                {analysis.microRewrites.map((rewrite, i) => (
                  <MicroRewriteItem key={i} rewrite={rewrite} />
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Delivery Metrics */}
          <CollapsibleSection 
            title="Delivery Metrics (Not Scored)" 
            defaultOpen={false}
            id={SECTION_IDS.delivery}
          >
            <div style={styles.deliveryBox}>
              <div style={styles.metricsGrid}>
                <div style={styles.metricItem}>
                  <div style={styles.metricItemValue}>{analysis.speechStats.wpm}</div>
                  <div style={styles.metricItemLabel}>WPM</div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricItemValue}>{analysis.speechStats.fillerPerMin.toFixed(1)}</div>
                  <div style={styles.metricItemLabel}>Fillers/min</div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricItemValue}>{analysis.speechStats.durationText}</div>
                  <div style={styles.metricItemLabel}>Duration</div>
                </div>
                <div style={styles.metricItem}>
                  <div style={styles.metricItemValue}>{analysis.speechStats.wordCount}</div>
                  <div style={styles.metricItemLabel}>Words</div>
                </div>
              </div>
              
              {analysis.deliveryMetricsCoaching?.drill && (
                <div style={styles.deliveryDrill}>
                  <div style={styles.drillTitle}>
                    Drill: {analysis.deliveryMetricsCoaching.drill.name}
                  </div>
                  <ol style={styles.drillSteps}>
                    {analysis.deliveryMetricsCoaching.drill.steps.map((step, i) => (
                      <li key={i} style={styles.drillStep}>{step}</li>
                    ))}
                  </ol>
                  <div style={styles.drillGoal}>
                    <strong>Goal:</strong> {analysis.deliveryMetricsCoaching.drill.goal}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Next-Round Checklist */}
          <CollapsibleSection 
            title="Next-Round Checklist" 
            defaultOpen={false}
            id={SECTION_IDS.checklist}
          >
            <div style={styles.checklistBox}>
              <div style={styles.checklistMain}>
                {(analysis.actionPlan?.nextRoundChecklist || []).map((item, i) => (
                  <div key={i} style={styles.checklistItem}>
                    <div style={styles.checklistStep}>{item.step}</div>
                    <div style={styles.checklistContent}>
                      <div style={styles.checklistInstruction}>{item.instruction}</div>
                      <div style={styles.checklistSuccess}>
                        Success: {item.successCriteria}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={styles.checklistExtras}>
                <div style={styles.checklistSection}>
                  <div style={styles.checklistSectionTitle}>5-Min Warmup</div>
                  <ul style={styles.checklistBullets}>
                    {(analysis.actionPlan?.warmup5Min || []).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                
                <div style={styles.checklistSection}>
                  <div style={styles.checklistSectionTitle}>During Speech Cues</div>
                  <ul style={styles.checklistBullets}>
                    {(analysis.actionPlan?.duringSpeechCues || []).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                
                <div style={styles.checklistSection}>
                  <div style={styles.checklistSectionTitle}>Post-Round Review</div>
                  <ul style={styles.checklistBullets}>
                    {(analysis.actionPlan?.postRoundReview || []).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Transcript */}
          <CollapsibleSection 
            title="Full Transcript" 
            defaultOpen={false}
            id={SECTION_IDS.transcript}
          >
            <div style={styles.transcriptBox}>
              <pre style={styles.transcriptText}>{transcript}</pre>
            </div>
          </CollapsibleSection>

          {/* Footer Actions */}
          <div style={styles.footerActions}>
            <button onClick={onRedoRound} style={styles.secondaryButton}>
              Redo Round
            </button>
            <button onClick={onNewRound} style={styles.primaryButton}>
              Start New Round
            </button>
            <button 
              onClick={handleExportPDF} 
              disabled={isExporting}
              style={styles.exportButton}
            >
              {isExporting ? 'Preparing PDF...' : 'Export to PDF'}
            </button>
          </div>
        </div>

        {/* Right Column - Sticky Score Sidebar */}
        <div style={styles.rightColumn}>
          <div style={styles.scoreSidebar}>
            {/* Overall Score */}
            <div style={styles.overallScoreCard}>
              <div style={styles.overallScoreLabel}>OVERALL SCORE</div>
              <div style={styles.overallScoreValue}>
                {analysis.scoring.overallScore.toFixed(1)}
                <span style={styles.overallMax}>/10</span>
              </div>
              <div style={styles.readinessRow}>
                Tournament Ready: 
                <span style={{ 
                  fontWeight: 700, 
                  marginLeft: 8,
                  color: analysis.scoring.tournamentReady ? '#111' : '#666',
                }}>
                  {analysis.scoring.tournamentReady ? 'YES' : 'NO'}
                </span>
              </div>
            </div>

            {/* Category Scores */}
            <div style={styles.categoryScores}>
              <div style={styles.categoryItem}>
                <div style={styles.categoryHeader}>
                  <span style={styles.categoryName}>Argument & Structure</span>
                  <span style={styles.categoryWeight}>45%</span>
                </div>
                <div style={styles.categoryBarContainer}>
                  <div 
                    style={{
                      ...styles.categoryBar,
                      width: `${(analysis.scoring.categoryScores.argumentStructure.score / 10) * 100}%`,
                    }}
                  />
                </div>
                <div style={styles.categoryScore}>
                  {analysis.scoring.categoryScores.argumentStructure.score.toFixed(1)}
                </div>
              </div>

              <div style={styles.categoryItem}>
                <div style={styles.categoryHeader}>
                  <span style={styles.categoryName}>Depth & Weighing</span>
                  <span style={styles.categoryWeight}>35%</span>
                </div>
                <div style={styles.categoryBarContainer}>
                  <div 
                    style={{
                      ...styles.categoryBar,
                      width: `${(analysis.scoring.categoryScores.depthWeighing.score / 10) * 100}%`,
                    }}
                  />
                </div>
                <div style={styles.categoryScore}>
                  {analysis.scoring.categoryScores.depthWeighing.score.toFixed(1)}
                </div>
              </div>

              <div style={styles.categoryItem}>
                <div style={styles.categoryHeader}>
                  <span style={styles.categoryName}>Rhetoric & Language</span>
                  <span style={styles.categoryWeight}>20%</span>
                </div>
                <div style={styles.categoryBarContainer}>
                  <div 
                    style={{
                      ...styles.categoryBar,
                      width: `${(analysis.scoring.categoryScores.rhetoricLanguage.score / 10) * 100}%`,
                    }}
                  />
                </div>
                <div style={styles.categoryScore}>
                  {analysis.scoring.categoryScores.rhetoricLanguage.score.toFixed(1)}
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div style={styles.quickStats}>
              <div style={styles.quickStatItem}>
                <span style={styles.quickStatValue}>{analysis.speechStats.wpm}</span>
                <span style={styles.quickStatLabel}>WPM</span>
              </div>
              <div style={styles.quickStatItem}>
                <span style={styles.quickStatValue}>{analysis.speechStats.durationText}</span>
                <span style={styles.quickStatLabel}>Duration</span>
              </div>
              <div style={styles.quickStatItem}>
                <span style={styles.quickStatValue}>{analysis.speechStats.fillerPerMin.toFixed(1)}</span>
                <span style={styles.quickStatLabel}>Fillers/min</span>
              </div>
            </div>

            {/* Section Navigation */}
            <div style={styles.navSection}>
              <div style={styles.navTitle}>Jump to Section</div>
              <button onClick={() => scrollToSection(SECTION_IDS.rfd)} style={styles.navButton}>
                Reason For Decision
              </button>
              <button onClick={() => scrollToSection(SECTION_IDS.evidence)} style={styles.navButton}>
                Evidence
              </button>
              <button onClick={() => scrollToSection(SECTION_IDS.levers)} style={styles.navButton}>
                Levers
              </button>
              <button onClick={() => scrollToSection(SECTION_IDS.checklist)} style={styles.navButton}>
                Checklist
              </button>
              <button onClick={() => scrollToSection(SECTION_IDS.delivery)} style={styles.navButton}>
                Delivery
              </button>
              <button onClick={() => scrollToSection(SECTION_IDS.transcript)} style={styles.navButton}>
                Transcript
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================
// STYLES - Black/White/Gray Theme
// ===========================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '24px 32px 80px 32px',
    background: '#fff',
    color: '#111',
    fontFamily: "'Segoe UI', -apple-system, sans-serif",
    maxWidth: '1400px',
    margin: '0 auto',
  },
  backLink: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '0.9rem',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '16px',
    textAlign: 'left',
    width: 'fit-content',
  },
  
  // Main Layout
  mainLayout: {
    display: 'flex',
    gap: '32px',
  },
  leftColumn: {
    flex: 1,
    minWidth: 0,
  },
  rightColumn: {
    width: '280px',
    flexShrink: 0,
  },
  
  // Score Sidebar (Sticky)
  scoreSidebar: {
    position: 'sticky',
    top: '80px', // Account for navbar
    background: '#fafafa',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
  },
  overallScoreCard: {
    textAlign: 'center',
    paddingBottom: '16px',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: '16px',
  },
  overallScoreLabel: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: '#666',
    letterSpacing: '0.1em',
    marginBottom: '4px',
  },
  overallScoreValue: {
    fontSize: '2.5rem',
    fontWeight: 800,
    color: '#111',
    lineHeight: 1,
  },
  overallMax: {
    fontSize: '0.9rem',
    color: '#999',
    fontWeight: 400,
  },
  readinessRow: {
    marginTop: '10px',
    fontSize: '0.8rem',
    color: '#666',
  },
  
  // Category Scores
  categoryScores: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '16px',
  },
  categoryItem: {},
  categoryHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  categoryName: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#374151',
  },
  categoryWeight: {
    fontSize: '0.7rem',
    color: '#9ca3af',
  },
  categoryBarContainer: {
    height: '5px',
    background: '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  categoryBar: {
    height: '100%',
    background: '#111',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  categoryScore: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#111',
    marginTop: '2px',
  },
  
  // Quick Stats
  quickStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
    paddingTop: '12px',
    borderTop: '1px solid #e5e7eb',
  },
  quickStatItem: {
    textAlign: 'center',
  },
  quickStatValue: {
    display: 'block',
    fontSize: '1rem',
    fontWeight: 700,
    color: '#111',
  },
  quickStatLabel: {
    fontSize: '0.6rem',
    color: '#9ca3af',
    textTransform: 'uppercase',
  },
  
  // Section Navigation
  navSection: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid #e5e7eb',
  },
  navTitle: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#666',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  navButton: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    padding: '8px 10px',
    fontSize: '0.8rem',
    color: '#374151',
    cursor: 'pointer',
    borderRadius: '4px',
    marginBottom: '2px',
    transition: 'background 0.15s',
  },
  
  // Header
  header: {
    marginBottom: '16px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  tierBadge: {
    display: 'inline-block',
    background: '#111',
    color: '#fff',
    padding: '3px 10px',
    borderRadius: '3px',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    width: 'fit-content',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 800,
    margin: 0,
    letterSpacing: '-0.02em',
  },
  
  // Quote Box at Top
  quoteBoxTop: {
    background: '#fafafa',
    padding: '16px 20px',
    borderLeft: '3px solid #111',
    marginBottom: '20px',
  },
  quoteTheme: {
    fontSize: '0.7rem',
    color: '#666',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  quoteTextTop: {
    fontStyle: 'italic',
    fontSize: '1.05rem',
    lineHeight: 1.5,
    color: '#374151',
  },
  
  // Warnings
  warningsBox: {
    background: '#f9fafb',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    padding: '14px 16px',
    marginBottom: '20px',
  },
  warningsTitle: {
    fontWeight: 700,
    marginBottom: '6px',
    color: '#374151',
    fontSize: '0.85rem',
  },
  warningItem: {
    fontSize: '0.85rem',
    color: '#4b5563',
    marginBottom: '2px',
  },
  
  // Sections with Black Band Header
  section: {
    marginBottom: '12px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  sectionHeader: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: '#111',
    border: 'none',
    cursor: 'pointer',
    color: '#fff',
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  sectionToggle: {
    fontSize: '1.2rem',
    fontWeight: 400,
    color: '#9ca3af',
  },
  sectionContent: {
    padding: '16px',
  },
  badge: {
    fontSize: '0.7rem',
    color: '#9ca3af',
    fontWeight: 400,
  },
  
  // Transcript
  transcriptBox: {
    background: '#fafafa',
    borderRadius: '4px',
    padding: '12px',
    maxHeight: '350px',
    overflow: 'auto',
  },
  transcriptText: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    fontFamily: "'SF Mono', Consolas, monospace",
    fontSize: '0.85rem',
    lineHeight: 1.6,
    color: '#374151',
  },
  
  // RFD
  rfdBox: {
    background: '#fafafa',
    borderRadius: '4px',
    padding: '14px',
  },
  rfdSummary: {
    fontSize: '0.95rem',
    lineHeight: 1.7,
    margin: '0 0 14px 0',
    color: '#111',
  },
  rfdSection: {
    marginTop: '14px',
    paddingTop: '14px',
    borderTop: '1px solid #e5e7eb',
  },
  rfdSectionTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#374151',
    marginBottom: '8px',
  },
  rfdClaim: {
    background: '#fff',
    padding: '10px 12px',
    borderRadius: '4px',
    marginBottom: '6px',
    border: '1px solid #e5e7eb',
  },
  rfdBlocker: {
    background: '#f5f5f5',
    padding: '10px 12px',
    borderRadius: '4px',
    marginBottom: '6px',
    borderLeft: '3px solid #9ca3af',
  },
  evidenceRefs: {
    fontSize: '0.7rem',
    color: '#6b7280',
    marginTop: '4px',
    fontFamily: 'monospace',
  },
  
  // Evidence
  evidenceGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  evidenceColumn: {},
  evidenceColumnTitle: {
    fontSize: '0.8rem',
    fontWeight: 700,
    marginBottom: '8px',
    color: '#374151',
  },
  evidenceItem: {
    background: '#fff',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '8px',
    border: '1px solid #e5e7eb',
  },
  evidenceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  evidenceLabel: {
    padding: '2px 6px',
    borderRadius: '2px',
    fontSize: '0.6rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  evidenceId: {
    fontSize: '0.65rem',
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  quoteBox: {
    background: '#fafafa',
    padding: '8px',
    borderRadius: '3px',
    marginBottom: '8px',
  },
  quoteText: {
    fontStyle: 'italic',
    fontSize: '0.85rem',
    color: '#374151',
  },
  timeRange: {
    display: 'block',
    fontSize: '0.65rem',
    color: '#9ca3af',
    marginTop: '3px',
  },
  metricBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#fafafa',
    padding: '8px',
    borderRadius: '3px',
    marginBottom: '8px',
  },
  metricName: {
    fontWeight: 600,
    color: '#374151',
    fontSize: '0.8rem',
  },
  metricValue: {
    fontFamily: 'monospace',
    fontWeight: 700,
    fontSize: '0.85rem',
  },
  warrant: {
    fontSize: '0.8rem',
    lineHeight: 1.5,
    color: '#4b5563',
    margin: 0,
  },
  
  // Levers
  leversContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  leverCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  leverHeader: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: '#fafafa',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  leverHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  leverRank: {
    background: '#111',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '2px',
    fontSize: '0.7rem',
    fontWeight: 700,
  },
  leverName: {
    fontWeight: 600,
    fontSize: '0.85rem',
    color: '#111',
  },
  scoreGain: {
    background: '#e5e7eb',
    color: '#374151',
    padding: '2px 5px',
    borderRadius: '2px',
    fontSize: '0.7rem',
    fontWeight: 600,
  },
  leverToggle: {
    fontSize: '1.1rem',
    fontWeight: 400,
    color: '#9ca3af',
  },
  leverBody: {
    padding: '14px',
    borderTop: '1px solid #e5e7eb',
  },
  leverSection: {
    marginBottom: '12px',
  },
  leverSectionLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#6b7280',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  leverText: {
    fontSize: '0.85rem',
    lineHeight: 1.5,
    margin: 0,
    color: '#374151',
  },
  patternBadge: {
    background: '#f5f5f5',
    color: '#374151',
    padding: '3px 8px',
    borderRadius: '2px',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  fixRule: {
    background: '#fafafa',
    padding: '8px 10px',
    borderRadius: '3px',
    fontWeight: 600,
    color: '#111',
    margin: 0,
    fontSize: '0.85rem',
    borderLeft: '3px solid #111',
  },
  sayThisBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sayThisLine: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    background: '#fafafa',
    padding: '8px',
    borderRadius: '3px',
  },
  sayThisNumber: {
    background: '#e5e7eb',
    color: '#374151',
    padding: '1px 5px',
    borderRadius: '2px',
    fontSize: '0.7rem',
    fontWeight: 700,
  },
  sayThisText: {
    fontStyle: 'italic',
    flex: 1,
    fontSize: '0.85rem',
    color: '#374151',
  },
  coachQuestions: {
    margin: 0,
    paddingLeft: '16px',
    fontSize: '0.85rem',
  },
  coachQuestion: {
    marginBottom: '4px',
    color: '#374151',
  },
  drillSteps: {
    margin: '0 0 8px 0',
    paddingLeft: '16px',
    fontSize: '0.85rem',
  },
  drillStep: {
    marginBottom: '4px',
    color: '#374151',
  },
  drillGoal: {
    background: '#f5f5f5',
    color: '#374151',
    padding: '8px',
    borderRadius: '3px',
    fontSize: '0.8rem',
  },
  drillTitle: {
    fontWeight: 700,
    marginBottom: '8px',
    color: '#111',
    fontSize: '0.85rem',
  },
  
  // Micro-Rewrites
  rewritesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  rewriteCard: {
    background: '#fafafa',
    borderRadius: '4px',
    padding: '14px',
  },
  rewriteBefore: {
    marginBottom: '6px',
  },
  rewriteAfter: {
    marginBottom: '10px',
  },
  rewriteLabel: {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: '3px',
    letterSpacing: '0.03em',
  },
  rewriteQuote: {
    fontStyle: 'italic',
    color: '#6b7280',
    background: '#fff',
    padding: '8px',
    borderRadius: '3px',
    border: '1px solid #e5e7eb',
    fontSize: '0.85rem',
  },
  rewriteArrow: {
    textAlign: 'center',
    fontSize: '1rem',
    color: '#9ca3af',
    margin: '3px 0',
  },
  rewriteText: {
    color: '#111',
    background: '#fff',
    padding: '8px',
    borderRadius: '3px',
    fontWeight: 500,
    border: '1px solid #e5e7eb',
    fontSize: '0.85rem',
  },
  rewriteWhy: {
    fontSize: '0.8rem',
    color: '#4b5563',
    borderTop: '1px solid #e5e7eb',
    paddingTop: '8px',
    marginTop: '3px',
  },
  
  // Delivery Metrics
  deliveryBox: {},
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '10px',
    marginBottom: '14px',
  },
  metricItem: {
    background: '#111',
    color: '#fff',
    borderRadius: '4px',
    padding: '10px',
    textAlign: 'center',
  },
  metricItemValue: {
    fontSize: '1.2rem',
    fontWeight: 800,
  },
  metricItemLabel: {
    fontSize: '0.65rem',
    color: '#9ca3af',
    marginTop: '2px',
  },
  deliveryDrill: {
    background: '#fafafa',
    borderRadius: '4px',
    padding: '12px',
  },
  
  // Checklist
  checklistBox: {},
  checklistMain: {
    marginBottom: '16px',
  },
  checklistItem: {
    display: 'flex',
    gap: '10px',
    background: '#fafafa',
    borderRadius: '4px',
    padding: '10px 12px',
    marginBottom: '8px',
    borderLeft: '3px solid #111',
  },
  checklistStep: {
    background: '#111',
    color: '#fff',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.75rem',
    flexShrink: 0,
  },
  checklistContent: {
    flex: 1,
  },
  checklistInstruction: {
    fontWeight: 600,
    marginBottom: '2px',
    fontSize: '0.85rem',
    color: '#111',
  },
  checklistSuccess: {
    fontSize: '0.75rem',
    color: '#6b7280',
  },
  checklistExtras: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
  },
  checklistSection: {
    background: '#fafafa',
    borderRadius: '4px',
    padding: '10px',
  },
  checklistSectionTitle: {
    fontWeight: 700,
    marginBottom: '8px',
    fontSize: '0.75rem',
    color: '#374151',
  },
  checklistBullets: {
    margin: 0,
    paddingLeft: '14px',
    fontSize: '0.8rem',
    color: '#4b5563',
  },
  
  // Footer Actions
  footerActions: {
    marginTop: '24px',
    display: 'flex',
    justifyContent: 'center',
    gap: '10px',
    paddingTop: '20px',
    borderTop: '1px solid #e5e7eb',
  },
  primaryButton: {
    background: '#111',
    color: '#fff',
    border: 'none',
    padding: '10px 24px',
    borderRadius: '4px',
    fontSize: '0.9rem',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryButton: {
    background: '#fff',
    color: '#111',
    border: '2px solid #111',
    padding: '8px 24px',
    borderRadius: '4px',
    fontSize: '0.9rem',
    fontWeight: 700,
    cursor: 'pointer',
  },
  exportButton: {
    background: '#f5f5f5',
    color: '#374151',
    border: '1px solid #d1d5db',
    padding: '8px 24px',
    borderRadius: '4px',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
