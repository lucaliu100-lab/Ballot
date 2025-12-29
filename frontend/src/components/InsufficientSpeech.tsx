/**
 * InsufficientSpeech Component
 *
 * Shown when the transcript/audio is too short to score competitively.
 * This prevents saving an invalid session and prompts the user to redo.
 */

import React from 'react';

interface InsufficientSpeechProps {
  wordCount: number;
  reason: string;
  onRedoRound: () => void;
  onNewRound: () => void;
  onGoHome: () => void;
}

function InsufficientSpeech({ wordCount, reason, onRedoRound, onNewRound, onGoHome }: InsufficientSpeechProps) {
  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        <div style={styles.header}>
          <div style={styles.kicker}>INSUFFICIENT LENGTH</div>
          <h2 style={styles.title}>Too Short to Score Competitively</h2>
          <p style={styles.subtitle}>
            We couldn’t generate a fair, tournament-grade ballot from this recording.
          </p>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>What happened</div>
          <p style={styles.cardText}>
            Your transcript was <strong>{wordCount}</strong> words. Competitive scoring requires a longer, continuous speech.
          </p>
          <div style={styles.divider} />
          <div style={styles.reasonRow}>
            <div style={styles.reasonLabel}>System note</div>
            <div style={styles.reasonText}>{reason || 'Transcript too short to evaluate.'}</div>
          </div>
        </div>

        <div style={styles.actions}>
          <button onClick={onRedoRound} style={styles.primaryButton}>
            Redo Round
          </button>
          <button onClick={onNewRound} style={styles.secondaryButton}>
            Start New Round
          </button>
          <button onClick={onGoHome} style={styles.tertiaryButton}>
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '1280px',
    margin: '0 auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: '900px',
    paddingTop: '72px',
    paddingBottom: '120px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  header: {
    textAlign: 'center',
    marginBottom: '48px',
  },
  kicker: {
    fontSize: '12px',
    color: '#6b7280',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: '10px',
  },
  title: {
    color: '#111827',
    fontSize: '36px',
    margin: '0 0 12px 0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '16px',
    margin: 0,
    maxWidth: '640px',
    lineHeight: 1.6,
  },
  card: {
    width: '100%',
    maxWidth: '800px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px',
    boxSizing: 'border-box',
  },
  cardTitle: {
    fontSize: '12px',
    fontWeight: 800,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '12px',
  },
  cardText: {
    margin: 0,
    color: '#111827',
    fontSize: '16px',
    lineHeight: 1.6,
    fontWeight: 500,
  },
  divider: {
    height: '1px',
    background: '#f3f4f6',
    margin: '18px 0',
    width: '100%',
  },
  reasonRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  reasonLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  reasonText: {
    fontSize: '14px',
    color: '#374151',
    lineHeight: 1.6,
  },
  actions: {
    marginTop: '48px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
    maxWidth: '360px',
    alignItems: 'center',
  },
  primaryButton: {
    width: '100%',
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
  },
  secondaryButton: {
    width: '100%',
    background: '#ffffff',
    color: '#111827',
    border: '1px solid #e5e7eb',
    padding: '16px 36px',
    fontSize: '16px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  tertiaryButton: {
    width: '100%',
    background: 'transparent',
    color: '#6b7280',
    border: 'none',
    padding: '10px 12px',
    fontSize: '14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 600,
    textDecoration: 'underline',
  },
};

export default InsufficientSpeech;



