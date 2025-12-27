/**
 * BallotView Component
 * 
 * Fetches all sessions to determine navigation context, then displays the
 * full Tournament Ballot for the selected session.
 * Acts as a page wrapper around FeedbackReport with added navigation.
 */

import { useMemo } from 'react';
import { db } from '../lib/instant';
import FeedbackReport from './FeedbackReport';
import { DebateAnalysis } from '../types';

interface BallotViewProps {
  sessionId: string;
  onGoHome: () => void;
  onRedoRound: () => void;
  onNewRound: () => void;
  onNavigate?: (id: string) => void;
}

function BallotView({ sessionId, onGoHome, onRedoRound, onNewRound, onNavigate }: BallotViewProps) {
  // Fetch ALL sessions to determine navigation order and find current
  const { isLoading, error, data } = db.useQuery({ 
    sessions: {} 
  });

  // Sort sessions by date (newest first, consistent with History list)
  const sessions = useMemo(() => {
      return data?.sessions 
        ? [...data.sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        : [];
  }, [data]);

  // Find current session index
  const currentIndex = sessions.findIndex(s => s.id === sessionId);
  const session = currentIndex !== -1 ? sessions[currentIndex] : null;

  // Navigation Logic
  // List is Newest (0) -> Oldest (N)
  // "Previous Round" (Back in time/Older) = Index + 1
  // "Next Round" (Forward in time/Newer) = Index - 1
  
  const prevSessionId = currentIndex < sessions.length - 1 ? sessions[currentIndex + 1].id : null;
  const nextSessionId = currentIndex > 0 ? sessions[currentIndex - 1].id : null;

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        color: '#666',
        fontFamily: "'Segoe UI', sans-serif"
      }}>
        Loading ballot...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        fontFamily: "'Segoe UI', sans-serif"
      }}>
        <h2>Ballot Not Found</h2>
        <p>The requested session could not be found.</p>
        <button 
          onClick={onGoHome}
          style={{
            marginTop: '20px',
            background: '#000',
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Return to History
        </button>
      </div>
    );
  }

  // Parse analysis data
  let analysis: DebateAnalysis | null = null;
  try {
    if (session.fullAnalysisJson) {
       // InstantDB might store as object or string depending on version
       if (typeof session.fullAnalysisJson === 'string') {
          analysis = JSON.parse(session.fullAnalysisJson);
       } else {
          analysis = session.fullAnalysisJson;
       }
    }
  } catch (e) {
    console.error("Failed to parse analysis JSON", e);
  }

  if (!analysis) {
     return (
        <div style={{padding: '40px', textAlign: 'center'}}>
           Ballot data is incomplete or corrupted.
           <br/>
           <button onClick={onGoHome}>Return to History</button>
        </div>
     );
  }

  return (
    <>
      <FeedbackReport
        analysis={analysis}
        theme={session.theme}
        quote={session.quote}
        transcript={session.transcript}
        videoFilename={session.videoFilename || ''}
        onGoHome={onGoHome}
        onRedoRound={onRedoRound}
        onNewRound={onNewRound}
        backLabel="← Back to History"
      />

      {/* Floating Navigation Controls */}
      <div style={{
          position: 'fixed',
          bottom: '32px',
          right: '32px',
          display: 'flex',
          gap: '12px',
          zIndex: 1000,
          background: 'rgba(255,255,255,0.9)',
          padding: '8px',
          borderRadius: '40px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          backdropFilter: 'blur(8px)'
      }}>
          <button 
             disabled={!prevSessionId}
             onClick={() => prevSessionId && onNavigate?.(prevSessionId)}
             title="Previous (Older) Round"
             style={{
                 background: prevSessionId ? '#111827' : '#f3f4f6',
                 color: prevSessionId ? '#fff' : '#d1d5db',
                 border: 'none',
                 padding: '12px 24px',
                 borderRadius: '30px',
                 fontWeight: 700,
                 fontSize: '0.9rem',
                 cursor: prevSessionId ? 'pointer' : 'default',
                 transition: 'all 0.2s',
                 display: 'flex',
                 alignItems: 'center',
                 gap: '8px'
             }}
          >
             <span>←</span> Previous
          </button>
          <button 
             disabled={!nextSessionId}
             onClick={() => nextSessionId && onNavigate?.(nextSessionId)}
             title="Next (Newer) Round"
             style={{
                 background: nextSessionId ? '#111827' : '#f3f4f6',
                 color: nextSessionId ? '#fff' : '#d1d5db',
                 border: 'none',
                 padding: '12px 24px',
                 borderRadius: '30px',
                 fontWeight: 700,
                 fontSize: '0.9rem',
                 cursor: nextSessionId ? 'pointer' : 'default',
                 transition: 'all 0.2s',
                 display: 'flex',
                 alignItems: 'center',
                 gap: '8px'
             }}
          >
             Next <span>→</span>
          </button>
      </div>
    </>
  );
}

export default BallotView;
