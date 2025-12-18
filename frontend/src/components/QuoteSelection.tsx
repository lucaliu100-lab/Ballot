/**
 * QuoteSelection Component
 * 
 * Displays the theme and 3 quotes. User clicks on a quote to select it.
 * Once selected, we move to the prep timer phase.
 */

import { RoundData } from '../types';

// Props that this component receives from its parent
interface QuoteSelectionProps {
  roundData: RoundData;                    // Theme and quotes from API
  onQuoteSelect: (quote: string) => void;  // Called when user selects a quote
}

function QuoteSelection({ roundData, onQuoteSelect }: QuoteSelectionProps) {
  return (
    <div style={styles.container}>
      {/* Display the theme */}
      <div style={styles.themeSection}>
        <span style={styles.themeLabel}>Today's Theme</span>
        <h1 style={styles.theme}>{roundData.theme}</h1>
      </div>

      {/* Instructions */}
      <p style={styles.instruction}>
        Select a quote that inspires you:
      </p>

      {/* List of quotes to choose from */}
      <div style={styles.quotesContainer}>
        {roundData.quotes.map((quote, index) => (
          <button
            key={index}
            onClick={() => onQuoteSelect(quote)}
            style={styles.quoteButton}
            // Add hover effect by changing style on mouse events
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.background = '#fafafa';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.background = '#ffffff';
            }}
          >
            {/* Quote number indicator */}
            <span style={styles.quoteNumber}>{index + 1}</span>
            {/* The actual quote text */}
            <span style={styles.quoteText}>"{quote}"</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Styles for this component
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '80px 48px 120px 48px',
    background: '#ffffff',
  },
  themeSection: {
    marginBottom: '48px',
  },
  themeLabel: {
    color: '#666666',
    fontSize: '0.9rem',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    display: 'block',
  },
  theme: {
    color: '#111111',
    fontSize: '3rem',
    margin: '12px 0 0 0',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  instruction: {
    color: '#666666',
    fontSize: '1.1rem',
    marginBottom: '32px',
  },
  quotesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '800px',
  },
  quoteButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    background: '#ffffff',
    border: '2px solid #000000',
    borderRadius: '8px',
    padding: '24px 28px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'left',
  },
  quoteNumber: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    background: '#000000',
    borderRadius: '50%',
    color: '#ffffff',
    fontSize: '1rem',
    fontWeight: 600,
    flexShrink: 0,
  },
  quoteText: {
    color: '#333333',
    fontSize: '1.1rem',
    lineHeight: 1.6,
    fontStyle: 'italic',
  },
};

export default QuoteSelection;




