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
      {/* Theme display */}
      <div style={styles.themeSection}>
        <span style={styles.themeLabel}>Your Theme</span>
        <h1 style={styles.theme}>{roundData.theme}</h1>
      </div>

      {/* Instructions */}
      <div style={styles.instructionBox}>
        <p style={styles.instruction}>
          Take a moment to think about this theme. When you're ready to see the quotes, 
          press "End Pre-Round Preparation" below.
        </p>
      </div>

      {/* Action buttons */}
      <div style={styles.buttonGroup}>
        <button
          onClick={onChangeTheme}
          disabled={isChangingTheme}
          style={{
            ...styles.changeButton,
            opacity: isChangingTheme ? 0.6 : 1,
            cursor: isChangingTheme ? 'not-allowed' : 'pointer',
          }}
        >
          {isChangingTheme ? 'Loading...' : 'Change Another Theme'}
        </button>

        <button
          onClick={onEndPrep}
          disabled={isChangingTheme}
          style={{
            ...styles.endPrepButton,
            opacity: isChangingTheme ? 0.6 : 1,
            cursor: isChangingTheme ? 'not-allowed' : 'pointer',
          }}
        >
          End Pre-Round Preparation
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '80px 48px 48px 48px',
    background: '#ffffff',
    justifyContent: 'center',
  },
  themeSection: {
    marginBottom: '48px',
    textAlign: 'center',
  },
  themeLabel: {
    color: '#666666',
    fontSize: '1rem',
    textTransform: 'uppercase',
    letterSpacing: '3px',
    display: 'block',
    marginBottom: '16px',
  },
  theme: {
    color: '#111111',
    fontSize: '4rem',
    margin: 0,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  instructionBox: {
    maxWidth: '600px',
    margin: '0 auto 48px auto',
    textAlign: 'center',
  },
  instruction: {
    color: '#666666',
    fontSize: '1.1rem',
    lineHeight: 1.6,
    margin: 0,
  },
  buttonGroup: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  changeButton: {
    background: '#ffffff',
    color: '#333333',
    border: '2px solid #000000',
    padding: '14px 32px',
    fontSize: '1rem',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  endPrepButton: {
    background: '#000000',
    color: '#ffffff',
    border: '2px solid #000000',
    padding: '18px 48px',
    fontSize: '1.1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
};

export default ThemePreview;

