/**
 * ThemePreview Component
 * 
 * Shows only the theme with options to:
 * - Change to another random theme
 * - End pre-round preparation and move to quote selection
 */

import { RoundData } from '../types';

interface ThemePreviewProps {
  roundData: RoundData;
  onChangeTheme: () => void;       // Request a new theme
  onEndPrep: () => void;           // Move to quote selection
  isChangingTheme: boolean;        // Loading state for theme change
}

function ThemePreview({ roundData, onChangeTheme, onEndPrep, isChangingTheme }: ThemePreviewProps) {
  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Theme</h2>
        </div>

        {/* Theme Card */}
        <div style={styles.themeCard}>
          <h1 style={styles.themeText}>{roundData.theme}</h1>
        </div>

        {/* Action buttons */}
        <div style={styles.buttonGroup}>
          <button
            onClick={onEndPrep}
            disabled={isChangingTheme}
            style={styles.primaryButton}
          >
            Reveal Quotes
          </button>
          
          <button
            onClick={onChangeTheme}
            disabled={isChangingTheme}
            style={styles.secondaryButton}
          >
            {isChangingTheme ? 'Loading...' : 'Not interested? Click to see a new theme'}
          </button>
        </div>
      </div>

      {/* Step Indicator at Bottom */}
      <div style={styles.stepIndicator}>
        STEP 1 OF 4
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 64px)', // Account for navbar
    overflow: 'hidden',
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '1280px',
    margin: '0 auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    alignItems: 'center',
    position: 'relative',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: '900px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '-32px', // Shift up to feel centered with navbar
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  title: {
    color: '#111827',
    fontSize: '56px',
    margin: '0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  themeCard: {
    width: '100%',
    maxWidth: '600px',
    padding: '60px 40px',
    background: '#fafafa',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    textAlign: 'center',
    marginBottom: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '180px',
  },
  themeText: {
    color: '#111827',
    fontSize: '56px',
    margin: 0,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  },
  buttonGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    width: '100%',
  },
  primaryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '20px 48px',
    fontSize: '1.1rem',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 700,
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    minWidth: '240px',
  },
  secondaryButton: {
    background: 'transparent',
    color: '#6b7280',
    border: 'none',
    padding: '12px 24px',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'color 0.2s ease',
  },
  stepIndicator: {
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '12px',
    fontWeight: 700,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

export default ThemePreview;
