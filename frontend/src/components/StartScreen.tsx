/**
 * StartScreen Component
 * 
 * The initial screen that shows a button to start a new practice round.
 * When clicked, it calls the API to get a theme and quotes.
 */

import { useState } from 'react';
import { RoundData } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Props that this component receives from its parent
interface StartScreenProps {
  onRoundStart: (data: RoundData) => void;  // Called when round data is loaded
}

function StartScreen({ onRoundStart }: StartScreenProps) {
  // Track loading state while fetching from API
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle the "Start Round" button click
  const handleStartRound = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('🎬 Start Round: requesting /api/start-round...');

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10_000);

      // Call our backend API to get theme and quotes
      const response = await fetch(API_ENDPOINTS.startRound, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      window.clearTimeout(timeoutId);

      // Check if request was successful
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
        } catch {
          // ignore
        }
        const suffix = details ? `: ${details}` : '';
        throw new Error(`Failed to start round (${response.status})${suffix}`);
      }

      // Parse the JSON response
      const data: RoundData = await response.json();
      console.log('✅ Start Round: received theme/quotes', data);
      
      // Pass the data to parent component
      onRoundStart(data);
    } catch (err) {
      // Handle any errors
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Start round timed out. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* App title and description */}
      <h1 style={styles.title}>Speech Practice</h1>
      <p style={styles.subtitle}>
        Improve your speaking skills with daily practice rounds
      </p>

      {/* Instructions */}
      <div style={styles.instructions}>
        <p style={styles.instructionsTitle}><strong>How it works:</strong></p>
        <ol style={styles.list}>
          <li>Get a theme and 3 inspiring quotes</li>
          <li>Select the quote that resonates with you</li>
          <li>Prepare your thoughts (2 minutes)</li>
          <li>Record your speech on camera</li>
        </ol>
      </div>

      {/* Start button */}
      <button
        onClick={handleStartRound}
        disabled={loading}
        style={{
          ...styles.button,
          opacity: loading ? 0.7 : 1,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Loading...' : 'Start Round'}
      </button>

      {/* Error message if something went wrong */}
      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}
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
  title: {
    color: '#111111',
    fontSize: '3rem',
    margin: '0 0 16px 0',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#666666',
    fontSize: '1.25rem',
    margin: '0 0 48px 0',
    lineHeight: 1.5,
    maxWidth: '600px',
  },
  instructions: {
    maxWidth: '600px',
    padding: '32px',
    marginBottom: '48px',
    border: '1px solid #000000',
    borderRadius: '8px',
    background: '#fafafa',
  },
  instructionsTitle: {
    color: '#111111',
    margin: '0 0 8px 0',
  },
  list: {
    margin: '16px 0 0 0',
    paddingLeft: '24px',
    lineHeight: 2,
    color: '#333333',
  },
  button: {
    background: '#000000',
    color: '#ffffff',
    border: '2px solid #000000',
    padding: '18px 48px',
    fontSize: '1.1rem',
    fontWeight: 600,
    borderRadius: '8px',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  error: {
    marginTop: '24px',
    padding: '16px 20px',
    background: '#fef2f2',
    border: '1px solid #dc2626',
    borderRadius: '8px',
    color: '#dc2626',
    maxWidth: '600px',
  },
};

export default StartScreen;




