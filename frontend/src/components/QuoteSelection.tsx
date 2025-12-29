/**
 * QuoteSelection Component
 * 
 * Displays the theme and 3 quotes. User clicks on a quote to select it.
 * Once selected, we move to the prep timer phase.
 */

import { useMemo, useState } from 'react';
import { RoundData } from '../types';

// Props that this component receives from its parent
interface QuoteSelectionProps {
  roundData: RoundData;                    // Theme and quotes from API
  onQuoteSelect: (quote: string) => void;  // Called when user selects a quote
}

function QuoteSelection({ roundData, onQuoteSelect }: QuoteSelectionProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const contentOffsetPx = 44; // Align headers with quote text start (badge width 28 + gap 16)

  const parsedQuotes = useMemo(() => {
    return (roundData.quotes || []).map((raw) => {
      const text = String(raw ?? '');

      // Try to split attribution off the end in common formats:
      // "Quote text — Author" or "Quote text - Author"
      const dashSplit = text.split(' — ');
      if (dashSplit.length >= 2) {
        const quoteText = dashSplit.slice(0, -1).join(' — ').trim();
        const attribution = dashSplit[dashSplit.length - 1].trim();
        return { quoteText, attribution };
      }

      const hyphenSplit = text.split(' - ');
      if (hyphenSplit.length >= 2) {
        const quoteText = hyphenSplit.slice(0, -1).join(' - ').trim();
        const attribution = hyphenSplit[hyphenSplit.length - 1].trim();
        return { quoteText, attribution };
      }

      return { quoteText: text.trim(), attribution: '' };
    });
  }, [roundData.quotes]);

  const handleSelect = (index: number) => {
    if (index < 0 || index >= parsedQuotes.length) return;
    if (selectedIndex !== null) return; // prevent double-click races

    setSelectedIndex(index);
    // Give a brief moment so the selected blue border is visible before navigating.
    window.setTimeout(() => {
      onQuoteSelect(roundData.quotes[index]);
    }, 200);
  };

  return (
    <div style={styles.container}>
      {/* Display the theme */}
      <div style={styles.inner}>
        <div style={{ ...styles.headerBlock, paddingLeft: `${contentOffsetPx}px` }}>
          <div style={styles.themeSection}>
            <div style={styles.themeLabel}>TODAY'S THEME</div>
            <h1 style={styles.theme}>{roundData.theme}</h1>
          </div>

          {/* Instructions */}
          <p style={styles.instruction}>Select a quote that inspires you</p>
        </div>

        {/* List of quotes to choose from */}
        <div style={styles.quotesContainer}>
          {parsedQuotes.map((q, index) => {
            const isHovered = hoveredIndex === index;
            const isSelected = selectedIndex === index;

            return (
              <button
                key={index}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  ...styles.quoteCard,
                  borderColor: isSelected
                    ? '#2563eb'
                    : isHovered
                      ? '#9ca3af'
                      : '#e5e7eb',
                  background: isHovered ? '#fafafa' : '#ffffff',
                }}
              >
                <div style={styles.badge}>{index + 1}</div>
                <div style={styles.quoteBody}>
                  <div style={styles.quoteText}>
                    “{q.quoteText}”
                    {q.attribution ? (
                      <span style={styles.attribution}> — {q.attribution}</span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
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
    padding: '0 24px',
    background: '#ffffff',
    maxWidth: '1280px',
    margin: '0 auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  inner: {
    width: '100%',
    paddingTop: '72px',
    paddingBottom: '120px',
  },
  headerBlock: {
    maxWidth: '800px',
    margin: '0 auto',
  },
  themeSection: {
    marginBottom: '60px',
  },
  themeLabel: {
    color: '#6b7280',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    display: 'block',
  },
  theme: {
    color: '#111827',
    fontSize: '48px',
    margin: '8px 0 0 0',
    fontWeight: 800,
    letterSpacing: '-0.02em',
  },
  instruction: {
    color: '#6b7280',
    fontSize: '18px',
    margin: '0 0 40px 0',
    fontWeight: 400,
  },
  quotesContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '800px',
    margin: '0 auto',
  },
  quoteCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px',
    cursor: 'pointer',
    transition: 'background-color 200ms ease, border-color 200ms ease',
    textAlign: 'left',
  },
  badge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    background: '#000000',
    borderRadius: '999px',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: '2px',
  },
  quoteText: {
    color: '#111827',
    fontSize: '16px',
    lineHeight: 1.7,
    fontWeight: 500,
  },
  attribution: {
    color: '#6b7280',
    fontStyle: 'italic',
    fontWeight: 400,
  },
  quoteBody: {
    flex: 1,
  },
};

export default QuoteSelection;




