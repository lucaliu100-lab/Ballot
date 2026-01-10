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

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DebateAnalysis } from '../types';

// Parse feedback into structured 4 sections for PDF
function parseFeedbackForPDF(feedback: string): {
  justification: string;
  evidence: string[];
  meaning: string;
  improvement: string;
  hasMissingSections: boolean;
} {
  const result = {
    justification: '',
    evidence: [] as string[],
    meaning: '',
    improvement: '',
    hasMissingSections: false,
  };

  if (!feedback) {
    result.hasMissingSections = true;
    return result;
  }

  // Normalize escaped newlines
  const text = feedback.replace(/\\n/g, '\n').replace(/\*\*/g, '');

  // Extract Score Justification
  const justMatch = text.match(/Score Justification:?\s*([\s\S]*?)(?=Evidence|What This|How to|$)/i);
  if (justMatch) result.justification = justMatch[1].trim();

  // Extract Evidence bullets
  const evidenceMatch = text.match(/Evidence(?:\s+from\s+Speech)?:?\s*([\s\S]*?)(?=What This|How to|$)/i);
  if (evidenceMatch) {
    result.evidence = evidenceMatch[1]
      .split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l.length > 10);
  }

  // Extract What This Means
  const meaningMatch = text.match(/What This Means:?\s*([\s\S]*?)(?=How to|$)/i);
  if (meaningMatch) result.meaning = meaningMatch[1].trim();

  // Extract How to Improve
  const improveMatch = text.match(/How to Improve:?\s*([\s\S]*?)$/i);
  if (improveMatch) result.improvement = improveMatch[1].trim();

  // Check if any section is missing
  result.hasMissingSections = !result.justification || result.evidence.length < 1 || !result.improvement;

  // Fallback: if no structured sections, use whole text as justification
  if (!result.justification && !result.evidence.length && !result.meaning && !result.improvement) {
    result.justification = text.trim();
  }

  return result;
}

// Format a single analysis item for PDF with structured sections
function formatAnalysisItemForPDF(title: string, score: number | null, feedback: string, notAssessable: boolean = false): string {
  const formatScore = (s: number | null) => s !== null ? s.toFixed(1) : 'N/A';
  const parsed = parseFeedbackForPDF(feedback);
  
  const scoreStyle = notAssessable ? 'background: #9ca3af;' : '';
  const warningLine = parsed.hasMissingSections 
    ? '<div style="color: #b45309; font-size: 11px; margin-top: 4px;">⚠️ Some feedback sections may be incomplete</div>' 
    : '';

  return `
    <div class="analysis-item">
      <div class="analysis-header">
        <span class="analysis-title">${title}</span>
        <span class="analysis-score" style="${scoreStyle}">${formatScore(score)}</span>
      </div>
      ${warningLine}
      ${parsed.justification ? `
        <div class="feedback-section">
          <div class="feedback-label">JUSTIFICATION</div>
          <p class="feedback-text">${parsed.justification}</p>
        </div>
      ` : ''}
      ${parsed.evidence.length > 0 ? `
        <div class="feedback-section">
          <div class="feedback-label">EVIDENCE</div>
          <ul class="evidence-list">
            ${parsed.evidence.map(e => `<li>${e}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${parsed.meaning ? `
        <div class="feedback-section">
          <div class="feedback-label">COMPETITIVE IMPACT</div>
          <p class="feedback-text" style="font-style: italic;">${parsed.meaning}</p>
        </div>
      ` : ''}
      ${parsed.improvement ? `
        <div class="feedback-section">
          <div class="feedback-label">HOW TO IMPROVE</div>
          <p class="feedback-text">${parsed.improvement}</p>
        </div>
      ` : ''}
    </div>
  `;
}

// PDF Export function - generates a printable version and triggers print dialog
function generatePDFContent(
  analysis: DebateAnalysis,
  theme: string,
  quote: string,
  statsInfo: { duration: string; words: number; wpm: number; fillers: number }
): string {
  const formatScore = (score: number | null) => score !== null ? score.toFixed(1) : 'N/A';
  const isBodyLanguageAssessable = analysis.bodyLanguageAssessable !== false;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Tournament Ballot - ${theme}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #111827;
      line-height: 1.5;
      padding: 40px;
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 2px solid #e5e7eb;
    }
    .tier-badge {
      display: inline-block;
      background: #111827;
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
    .title { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
    .subtitle { color: #6b7280; font-size: 14px; }
    .overall-score {
      text-align: center;
      margin: 24px 0;
      padding: 24px;
      background: #f9fafb;
      border-radius: 12px;
    }
    .overall-score-value {
      font-size: 48px;
      font-weight: 800;
      color: #92400e; /* Deep Amber */
    }
    .overall-score-label { font-size: 12px; color: #6b7280; letter-spacing: 0.1em; }
    .scores-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    .score-card {
      text-align: center;
      padding: 16px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .score-card-value { font-size: 24px; font-weight: 800; color: #92400e; }
    .score-card-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .stats-bar {
      display: flex;
      justify-content: space-around;
      padding: 16px;
      background: #0f172a; /* Slate 900 */
      color: white;
      border-radius: 8px;
      margin-bottom: 32px;
    }
    .stat-item { text-align: center; }
    .stat-label { font-size: 10px; color: #94a3b8; letter-spacing: 0.1em; }
    .stat-value { font-size: 16px; font-weight: 700; }
    .section { margin-bottom: 24px; page-break-inside: avoid; }
    .section-title {
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    .analysis-item {
      margin-bottom: 16px;
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .analysis-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .analysis-title { font-weight: 700; font-size: 14px; color: #1e293b; }
    .analysis-score {
      background: #1e293b;
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
    }
    .analysis-feedback { font-size: 13px; color: #334155; line-height: 1.6; }
    .feedback-section { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #e5e7eb; }
    .feedback-section:first-of-type { border-top: none; padding-top: 0; }
    .feedback-label { font-size: 10px; font-weight: 700; color: #6b7280; letter-spacing: 0.05em; margin-bottom: 4px; }
    .feedback-text { font-size: 12px; color: #334155; line-height: 1.5; margin: 0; }
    .evidence-list { margin: 0; padding-left: 16px; font-size: 12px; color: #475569; }
    .evidence-list li { margin-bottom: 4px; line-height: 1.4; }
    .priority-box {
      background: #fff8f8;
      border: 1px solid #fecaca;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .priority-title { font-size: 16px; font-weight: 700; color: #9f1239; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; }
    .priority-item { margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(159, 18, 57, 0.1); }
    .priority-item:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
    .priority-item-title { font-weight: 700; margin-bottom: 8px; color: #0f172a; }
    .priority-detail { font-size: 13px; color: #334155; margin-bottom: 4px; }
    .strengths-list { list-style: none; }
    .strength-item {
      padding: 8px 12px;
      background: #f0fdf4;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #064e3b;
      border: 1px solid #d1fae5;
    }
    .strength-item:before { content: "✓ "; color: #10b981; font-weight: bold; }
    .drill-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .drill-title { font-size: 16px; font-weight: 700; color: #4338ca; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .drill-text { font-size: 14px; color: #1e1b4b; line-height: 1.6; }
    .quote-box {
      margin-top: 24px;
      padding: 16px;
      background: #fafafa;
      border-left: 4px solid #92400e;
      font-style: italic;
      color: #334155;
    }
    .quote-label { font-style: normal; font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 12px;
      color: #9ca3af;
    }
    @media print {
      body { padding: 20px; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="tier-badge">${analysis.performanceTier.toUpperCase()} TIER</div>
    <h1 class="title">Tournament Ballot</h1>
    <p class="subtitle">NSDA-Standard Impromptu Evaluation</p>
  </div>

  <div class="overall-score">
    <div class="overall-score-label">OVERALL SCORE</div>
    <div class="overall-score-value">${formatScore(analysis.overallScore)}/10.0</div>
    <div style="margin-top: 8px; font-size: 14px;">
      Tournament Ready: <strong style="color: ${analysis.tournamentReady ? '#059669' : '#dc2626'}">${analysis.tournamentReady ? 'YES' : 'NO'}</strong>
    </div>
  </div>

  <div class="scores-grid">
    <div class="score-card">
      <div class="score-card-value">${formatScore(analysis.categoryScores.content.score)}</div>
      <div class="score-card-label">Content (${isBodyLanguageAssessable ? '40%' : '47%'})</div>
    </div>
    <div class="score-card">
      <div class="score-card-value">${formatScore(analysis.categoryScores.delivery.score)}</div>
      <div class="score-card-label">Delivery (${isBodyLanguageAssessable ? '30%' : '35%'})</div>
    </div>
    <div class="score-card">
      <div class="score-card-value">${formatScore(analysis.categoryScores.language.score)}</div>
      <div class="score-card-label">Language (${isBodyLanguageAssessable ? '15%' : '18%'})</div>
    </div>
    <div class="score-card" ${!isBodyLanguageAssessable ? 'style="opacity: 0.5;"' : ''}>
      <div class="score-card-value" ${!isBodyLanguageAssessable ? 'style="color: #9ca3af;"' : ''}>${isBodyLanguageAssessable ? formatScore(analysis.categoryScores.bodyLanguage.score) : 'N/A'}</div>
      <div class="score-card-label">${isBodyLanguageAssessable ? 'Body Language (15%)' : 'Body Language (Not Assessable)'}</div>
    </div>
  </div>

  <div class="stats-bar">
    <div class="stat-item">
      <div class="stat-label">DURATION</div>
      <div class="stat-value">${statsInfo.duration}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">WORDS</div>
      <div class="stat-value">${statsInfo.words}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">PACE</div>
      <div class="stat-value">${statsInfo.wpm} WPM</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">FILLERS</div>
      <div class="stat-value">${statsInfo.fillers} total</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">| Content Analysis (40%)</h2>
    ${formatAnalysisItemForPDF('Topic Adherence', analysis.contentAnalysis.topicAdherence.score, analysis.contentAnalysis.topicAdherence.feedback)}
    ${formatAnalysisItemForPDF('Argument Structure', analysis.contentAnalysis.argumentStructure.score, analysis.contentAnalysis.argumentStructure.feedback)}
    ${formatAnalysisItemForPDF('Depth of Analysis', analysis.contentAnalysis.depthOfAnalysis.score, analysis.contentAnalysis.depthOfAnalysis.feedback)}
  </div>

  <div class="section">
    <h2 class="section-title">| Delivery Analysis (30%)</h2>
    ${formatAnalysisItemForPDF('Vocal Variety', analysis.deliveryAnalysis.vocalVariety.score, analysis.deliveryAnalysis.vocalVariety.feedback)}
    ${formatAnalysisItemForPDF('Pacing & Tempo', analysis.deliveryAnalysis.pacing.score, analysis.deliveryAnalysis.pacing.feedback)}
  </div>

  <div class="section">
    <h2 class="section-title">| Language Use (15%)</h2>
    ${formatAnalysisItemForPDF('Vocabulary Sophistication', analysis.languageAnalysis.vocabulary.score, analysis.languageAnalysis.vocabulary.feedback)}
    ${formatAnalysisItemForPDF('Rhetorical Devices', analysis.languageAnalysis.rhetoricalDevices.score, analysis.languageAnalysis.rhetoricalDevices.feedback)}
  </div>

  <div class="section" ${!isBodyLanguageAssessable ? 'style="opacity: 0.6;"' : ''}>
    <h2 class="section-title">| Body Language & Presence (${isBodyLanguageAssessable ? '15%' : 'Not Assessable'})</h2>
    ${!isBodyLanguageAssessable ? `
    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
      <strong>⚠️ Not Assessable</strong>
      <p style="font-size: 13px; color: #92400e; margin: 4px 0 0 0;">
        Camera framing does not show head + hands + torso. Body language cannot be scored fairly.
        Weights have been renormalized among Content, Delivery, and Language.
      </p>
    </div>
    ` : ''}
    ${formatAnalysisItemForPDF('Eye Contact', analysis.bodyLanguageAnalysis.eyeContact.score, analysis.bodyLanguageAnalysis.eyeContact.feedback, !isBodyLanguageAssessable)}
    ${formatAnalysisItemForPDF('Gestures & Posture', analysis.bodyLanguageAnalysis.gestures.score, analysis.bodyLanguageAnalysis.gestures.feedback, !isBodyLanguageAssessable)}
  </div>

  <div class="priority-box">
    <h3 class="priority-title">Priority Improvements</h3>
    ${analysis.priorityImprovements.map(imp => `
      <div class="priority-item">
        <div class="priority-item-title">#${imp.priority} ${imp.issue}</div>
        <div class="priority-detail"><strong>Action:</strong> ${imp.action}</div>
        <div class="priority-detail"><strong>Impact:</strong> ${imp.impact}</div>
      </div>
    `).join('')}
  </div>

  <div class="drill-box">
    <h3 class="drill-title">Practice Drill</h3>
    <p class="drill-text">${analysis.practiceDrill}</p>
    <div style="margin-top: 12px; font-size: 13px; font-weight: 600; color: #0369a1;">
      Next Focus: ${analysis.nextSessionFocus.primary}
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">| Strengths to Maintain</h2>
    <ul class="strengths-list">
      ${analysis.strengths.map(s => `<li class="strength-item">${s}</li>`).join('')}
    </ul>
  </div>

  <div class="quote-box">
    <div class="quote-label">Theme: ${theme}</div>
    "${quote}"
  </div>

  <div class="footer">
    Generated by WinBallot • ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
  </div>
</body>
</html>
  `;
}

// Helper to get color based on score
function getScoreColor(score: number): string {
  if (score >= 8) return '#059669'; // Excellent (Emerald)
  if (score >= 6) return '#d97706'; // Good (Amber)
  if (score >= 4) return '#b45309'; // Fair (Ochre)
  return '#be123c'; // Poor (Crimson)
}

// Generate a deterministic hash from session content to prevent duplicates.
// IMPORTANT: Do NOT include timestamps here; the goal is stability across re-mounts.
function generateSessionHash(theme: string, quote: string, transcript: string, videoFilename: string): string {
  const content = `${theme}-${quote}-${transcript.substring(0, 200)}-${videoFilename}`;
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

  // CRITICAL: First normalize escaped newlines to actual newlines
  // The model may return \\n (escaped) instead of actual newlines in JSON
  let normalizedText = text
    .replace(/\\n/g, '\n')           // Convert escaped newlines
    .replace(/\\t/g, ' ')            // Convert escaped tabs
    .replace(/\r\n/g, '\n')          // Normalize Windows line endings
    .replace(/\r/g, '\n');           // Normalize old Mac line endings

  // Try multiple header variations for robustness
  // Score Justification patterns
  const justificationPatterns = [
    /\*\*Score Justification:?\*\*\s*([\s\S]*?)(?=\*\*Evidence|\*\*What This|\*\*How to|\*\*Improvement|$)/i,
    /\*\*Justification:?\*\*\s*([\s\S]*?)(?=\*\*Evidence|\*\*What This|\*\*How to|\*\*Improvement|$)/i,
    /Score Justification:?\s*([\s\S]*?)(?=Evidence from|What This|How to Improve|Improvement|$)/i,
  ];
  
  for (const pattern of justificationPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]?.trim()) {
      sections.justification = match[1].replace(/\*\*/g, '').trim();
      break;
    }
  }

  // Evidence patterns
  const evidencePatterns = [
    /\*\*Evidence(?:\s+from\s+Speech)?:?\*\*\s*([\s\S]*?)(?=\*\*What This|\*\*How to|\*\*Improvement|\*\*Judge|$)/i,
    /Evidence(?:\s+from\s+Speech)?:?\s*([\s\S]*?)(?=What This|How to Improve|Improvement|Judge|$)/i,
  ];
  
  for (const pattern of evidencePatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]?.trim()) {
      sections.evidence = match[1]
        .split("\n")
        .map(l => l.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "").trim())
        .filter(l => l.length > 0 && !l.startsWith('**'));
      break;
    }
  }

  // What This Means / Judge's Rationale patterns
  const meaningPatterns = [
    /\*\*What This Means:?\*\*\s*([\s\S]*?)(?=\*\*How to|\*\*Improvement|$)/i,
    /\*\*Judge'?s? Rationale:?\*\*\s*([\s\S]*?)(?=\*\*How to|\*\*Improvement|$)/i,
    /\*\*Competitive Implication:?\*\*\s*([\s\S]*?)(?=\*\*How to|\*\*Improvement|$)/i,
    /What This Means:?\s*([\s\S]*?)(?=How to Improve|Improvement|$)/i,
    /Judge'?s? Rationale:?\s*([\s\S]*?)(?=How to Improve|Improvement|$)/i,
  ];
  
  for (const pattern of meaningPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]?.trim()) {
      sections.meaning = match[1].replace(/\*\*/g, '').trim();
      break;
    }
  }

  // Improvement patterns
  const improvementPatterns = [
    /\*\*How to Improve:?\*\*\s*([\s\S]*?)$/i,
    /\*\*Improvements?:?\*\*\s*([\s\S]*?)$/i,
    /\*\*Actionable Steps?:?\*\*\s*([\s\S]*?)$/i,
    /How to Improve:?\s*([\s\S]*?)$/i,
    /Improvements?:?\s*([\s\S]*?)$/i,
  ];
  
  for (const pattern of improvementPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]?.trim()) {
      sections.improvement = match[1]
        .split("\n")
        .map(l => l.replace(/^\d+\.\s*/, "").replace(/^[-*•]\s*/, "").trim())
        .filter(l => l.length > 0 && !l.startsWith('**'));
      break;
    }
  }

  // If no structured sections found, use the whole text as justification
  if (!sections.justification && !sections.evidence.length && !sections.meaning && !sections.improvement.length) {
    sections.justification = normalizedText.replace(/\*\*/g, '').trim();
  }
  
  // If we got justification but nothing else, it might be unstructured - just use justification
  if (sections.justification && !sections.evidence.length && !sections.meaning && !sections.improvement.length) {
    // That's fine - we'll show only the justification and "FULL FEEDBACK" will show the rest
  }

  return sections;
}

interface AnalysisItemProps {
  title: string;
  score: number | null;
  feedback: string;
  showProgress?: boolean;
  customMetric?: string;
  /** If true, displays greyed-out "Not Assessable" state */
  notAssessable?: boolean;
}

const AnalysisItem = ({ title, score, feedback, showProgress = true, customMetric, notAssessable = false }: AnalysisItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const parsed = parseFeedback(feedback);
  const hasStructuredDetails =
    parsed.evidence.length > 0 || Boolean(parsed.meaning) || parsed.improvement.length > 0;
  
  // Handle null/not assessable state
  const displayScore = score !== null ? score : 0;
  const isNotAssessable = notAssessable || score === null;
  
  return (
    <div style={{ ...styles.analysisItem, opacity: isNotAssessable ? 0.6 : 1 }}>
      <div style={styles.analysisHeader}>
        <div style={styles.analysisTitleGroup}>
          <span style={styles.analysisTitle}>{title}</span>
          {isNotAssessable ? (
            <span style={styles.notAssessableBadge}>N/A</span>
          ) : (
            <span style={styles.scoreBadge}>{displayScore.toFixed(1)}</span>
          )}
          {customMetric && !isNotAssessable && <span style={styles.customMetricBadge}>{customMetric}</span>}
        </div>
        <div style={styles.analysisScore}>
          {showProgress && !isNotAssessable && (
            <div style={styles.progressBarBg}>
              <div style={{ ...styles.progressBarFill, width: `${displayScore * 10}%`, background: getScoreColor(displayScore) }} />
            </div>
          )}
          {!isNotAssessable && (
            <button 
              onClick={() => setIsExpanded(!isExpanded)} 
              style={styles.expandButton}
            >
              {isExpanded ? 'Hide Details ↑' : 'Deep Dive ↓'}
            </button>
          )}
        </div>
      </div>

      <div style={styles.feedbackContainerCompact}>
        {parsed.justification && (
          <p style={styles.justificationText}>{parsed.justification}</p>
        )}
        
        {isExpanded && !isNotAssessable && (
          <div style={styles.expandedContent}>
            <div style={styles.divider} />

            {/* Fallback: many models now return unstructured feedback without the old headings.
                If we can't parse structured sections, show the full feedback here so "Deep Dive" still works. */}
            {!hasStructuredDetails && (
              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>FULL FEEDBACK</div>
                <p style={styles.meaningText}>{feedback}</p>
              </div>
            )}
            
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
                <div style={styles.detailLabel}>IMPROVEMENTS</div>
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
  const overallLengthDeduction = Number((analysis as any)?.__rubric?.overallLengthDeduction || 0);
  // Track if we've already saved this session
  const savedRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // Generate a stable session key based on content (prevents duplicates across re-mounts)
  const sessionId = useMemo(() => {
    return generateSessionHash(theme, quote, transcript, videoFilename || 'no_video');
  }, [theme, quote, transcript, videoFilename]);

  // ===========================================
  // SAVE SESSION TO INSTANTDB
  // ===========================================

  useEffect(() => {
    // Only save once per feedback session using a stable key.
    // Prefer videoFilename because it is stable per recording/upload.
    const stableKey = videoFilename ? `video_${videoFilename}` : `hash_${sessionId}`;
    const saveKey = `saved_session_${stableKey}`;
    
    // Check if already saved (both in ref and sessionStorage for page refresh protection)
    if (savedRef.current || sessionStorage.getItem(saveKey) || readOnly) {
      console.log('📝 Skipping save - already saved or read-only');
      return;
    }
    
    // IMMEDIATELY mark as saved to prevent race conditions (React 18 Strict Mode runs effects twice)
    savedRef.current = true;
    sessionStorage.setItem(saveKey, 'true');
    
    // Don't save mock data
    if (isMock) {
      console.log('📝 Skipping save - mock data');
      return;
    }

    // Supabase not configured (common in first-time deployments / previews)
    const client = supabase;
    if (!client) {
      console.warn('📝 Skipping save - Supabase is not configured');
      return;
    }

    // Save the session to Supabase
    const saveSession = async () => {
      try {
        console.log('💾 Saving session to Supabase...');
        
        const { data: { user } } = await client.auth.getUser();
        
        if (!user) {
           console.error('No user found, cannot save session');
           // Reset flags so it can try again if user logs in
           savedRef.current = false;
           sessionStorage.removeItem(saveKey);
           return;
        }

        // Check if already saved in Supabase to prevent duplicates.
        // Use a stable identifier: the uploaded video filename is unique per recording.
        if (videoFilename) {
          const { data: existing, error: existingError } = await client
            .from('sessions')
            .select('id')
            .eq('user_id', user.id)
            .eq('video_filename', videoFilename)
            .maybeSingle();

          if (existingError) {
            // Don't hard fail saving if the lookup fails; we'll attempt insert and rely on sessionStorage
            console.warn('⚠️ Duplicate-check lookup failed, will attempt insert:', existingError.message);
          } else if (existing) {
            console.log('📝 Skipping save - session already exists in DB (video_filename match)');
            return;
          }
        }

        const { error } = await client.from('sessions').insert({
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
            // Store full analysis as JSON string for future-proofing
            full_analysis_json: JSON.stringify(analysis),
        });

        if (error) {
          // If insert failed (e.g., duplicate), don't reset flags
          console.error('❌ Failed to save session:', error);
          return;
        }

        console.log('✅ Session saved to Supabase');
      } catch (error) {
        console.error('❌ Failed to save session:', error);
      }
    };

    saveSession();
  }, [sessionId, analysis, theme, quote, transcript, videoFilename, isMock, readOnly]);

  // Helper to render a score circle
  const renderScoreRing = (score: number | null, label: string, weight: string, notAssessable: boolean = false) => {
    // Tournament Yellow styling
    const color = '#ca8a04';
    const greyColor = '#9ca3af';
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const displayScore = score ?? 0;
    const offset = notAssessable ? circumference : circumference - (displayScore / 10) * circumference;

    return (
      <div style={{ ...styles.scoreCard, opacity: notAssessable ? 0.5 : 1 }}>
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
              stroke={notAssessable ? greyColor : color}
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
              style={{ ...styles.ringScore, fill: notAssessable ? greyColor : color }}
            >
              {notAssessable ? 'N/A' : displayScore.toFixed(1)}
            </text>
          </svg>
          </div>
        <div style={styles.scoreInfo}>
          <div style={styles.scoreLabelMain}>{label}</div>
          <div style={styles.scoreWeight}>{notAssessable ? 'Not assessable' : `${weight} weight`}</div>
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

  // PDF Export handler
  const handleExportPDF = useCallback(() => {
    setIsExporting(true);
    
    try {
      const pdfContent = generatePDFContent(analysis, theme, quote, {
        duration: statsDuration,
        words: statsWords,
        wpm: statsWpm,
        fillers: statsFillers,
      });
      
      // Open a new window with the PDF content
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups to export PDF');
        setIsExporting(false);
        return;
      }
      
      printWindow.document.write(pdfContent);
      printWindow.document.close();
      
      // Wait for content to load, then trigger print
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          setIsExporting(false);
        }, 250);
      };
      
      // Fallback if onload doesn't fire
      setTimeout(() => {
        setIsExporting(false);
      }, 2000);
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to export PDF. Please try again.');
      setIsExporting(false);
    }
  }, [analysis, theme, quote, statsDuration, statsWords, statsWpm, statsFillers]);

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
        {renderScoreRing(analysis.categoryScores.content.score, 'Content', analysis.bodyLanguageAssessable === false ? '47%' : '40%')}
        {renderScoreRing(analysis.categoryScores.delivery.score, 'Delivery', analysis.bodyLanguageAssessable === false ? '35%' : '30%')}
        {renderScoreRing(analysis.categoryScores.language.score, 'Language', analysis.bodyLanguageAssessable === false ? '18%' : '15%')}
        {renderScoreRing(analysis.categoryScores.bodyLanguage.score, 'Body Language', '15%', analysis.bodyLanguageAssessable === false)}
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
          <div style={{ ...styles.analysisSectionWithBg, opacity: analysis.bodyLanguageAssessable === false ? 0.7 : 1 }}>
            <h2 style={styles.sectionHeader}>
              | Body Language & Presence ({analysis.bodyLanguageAssessable === false ? '0%' : '15%'})
            </h2>
            {analysis.bodyLanguageAssessable === false && (
              <div style={styles.notAssessableBanner}>
                <span style={styles.notAssessableIcon}>⚠️</span>
                <div style={styles.notAssessableContent}>
                  <strong>Not Assessable</strong>
                  <p style={styles.notAssessableText}>
                    Camera framing does not show head + hands + torso. Body language cannot be scored fairly.
                    <br />
                    <em>Weights have been renormalized: Content ~47%, Delivery ~35%, Language ~18%.</em>
                  </p>
                </div>
              </div>
            )}
            <AnalysisItem
              title="Eye Contact"
              score={analysis.bodyLanguageAnalysis.eyeContact.score}
              feedback={analysis.bodyLanguageAnalysis.eyeContact.feedback}
              notAssessable={analysis.bodyLanguageAssessable === false}
            />
            <AnalysisItem
              title="Gestures & Posture"
              score={analysis.bodyLanguageAnalysis.gestures.score}
              feedback={analysis.bodyLanguageAnalysis.gestures.feedback}
              notAssessable={analysis.bodyLanguageAssessable === false}
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
            {overallLengthDeduction > 0 && (
              <div style={styles.overallDeductionNote}>
                Deducted {overallLengthDeduction.toFixed(1)} due to suboptimal length.
              </div>
            )}
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
        <button 
          onClick={handleExportPDF} 
          disabled={isExporting}
          style={styles.exportButton}
        >
          {isExporting ? 'Preparing PDF...' : 'Export to PDF'}
        </button>
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
  rubricNote: {
    fontSize: '0.9rem',
    color: '#6b7280',
    marginTop: '-8px',
    marginBottom: '16px',
    lineHeight: 1.4,
  },
  overallDeductionNote: {
    marginTop: '8px',
    fontSize: '0.9rem',
    color: '#6b7280',
    lineHeight: 1.4,
  },
  subOptimalLengthNote: {
    marginTop: '-6px',
    marginBottom: '16px',
    fontSize: '0.9rem',
    color: '#6b7280',
    lineHeight: 1.4,
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
    background: '#fff8f8',
    border: '1px solid #fecaca',
    borderRadius: '16px',
    padding: '32px',
  },
  priorityBoxTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#9f1239', // Deep Rose
    marginBottom: '24px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  priorityItem: {
    marginBottom: '24px',
    paddingBottom: '24px',
    borderBottom: '1px solid rgba(159, 18, 57, 0.1)',
  },
  priorityItemTitle: {
    fontSize: '1rem',
    fontWeight: 800,
    marginBottom: '12px',
    color: '#111827',
  },
  priorityDetail: {
    fontSize: '0.9rem',
    lineHeight: 1.5,
    marginBottom: '8px',
    color: '#374151',
  },
  boldLabel: {
    fontWeight: 700,
    color: '#111827',
  },
  drillBox: {
    background: '#f8fafc', // Very light slate
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '32px',
  },
  drillBoxTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    color: '#4338ca', // Indigo
    marginBottom: '16px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  drillText: {
    fontSize: '0.95rem',
    lineHeight: 1.6,
    color: '#1e1b4b', // Deep Indigo
    marginBottom: '24px',
  },
  nextFocus: {
    borderTop: '1px solid rgba(67, 56, 202, 0.1)',
    paddingTop: '16px',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#4338ca',
  },
  nextFocusLabel: {
    fontWeight: 800,
    color: '#1e1b4b',
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
    background: '#f0fdf4', // Emerald tint
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '0.95rem',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontWeight: 600,
    color: '#064e3b', // Deep Emerald
    border: '1px solid #d1fae5',
  },
  checkmark: {
    color: '#10b981', // Emerald
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
  exportButton: {
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    padding: '14px 40px',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  notAssessableBadge: {
    background: '#9ca3af',
    color: '#ffffff',
    padding: '2px 10px',
    borderRadius: '4px',
    fontSize: '0.8rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  notAssessableBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '16px',
    background: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  notAssessableIcon: {
    fontSize: '1.5rem',
    flexShrink: 0,
  },
  notAssessableContent: {
    flex: 1,
  },
  notAssessableText: {
    fontSize: '0.9rem',
    color: '#92400e',
    margin: '4px 0 0 0',
    lineHeight: 1.5,
  },
};

export default FeedbackReport;

