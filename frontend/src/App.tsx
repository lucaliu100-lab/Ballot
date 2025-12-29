/**
 * Main App Component - Speech Practice Application
 * 
 * This component manages the overall flow of the application:
 * 1. Authentication - User signs in with email
 * 2. Start Screen - User clicks "Start Round"
 * 3. Quote Selection - User picks a quote to speak about
 * 4. Prep Timer - 2 minute countdown to prepare
 * 5. Record Screen - Camera preview and recording
 * 6. Processing Screen - AI analyzes speech and body language
 * 7. Report Screen - Shows feedback with redo/new round options
 * 
 * The flow is managed using a simple state machine pattern.
 * User sessions are persisted to InstantDB for history tracking.
 */

import { useEffect, useState } from 'react';

// Import Supabase
import { supabase, isSupabaseConfigured } from './lib/supabase';

// Import shared utilities and constants
import { PREP_TIMER_DURATION, API_ENDPOINTS } from './lib/constants';
import { extractFilename } from './lib/utils';

// Import types
import { FlowStep, RoundData, UploadResponse, DebateAnalysis } from './types';

// Import all screen components
import Login from './components/Login';
import UpdatePassword from './components/UpdatePassword';
import LandingPage from './components/LandingPage';
import StartScreen from './components/StartScreen';
import ThemePreview from './components/ThemePreview';
import QuoteSelection from './components/QuoteSelection';
import PrepTimer from './components/PrepTimer';
import RecordScreen from './components/RecordScreen';
import UploadSuccess from './components/UploadSuccess';
import InsufficientSpeech from './components/InsufficientSpeech';
import FeedbackReport from './components/FeedbackReport';
import Navbar from './components/Navbar';
import History from './components/History';
import BallotView from './components/BallotView';

function App() {
  // ==========================================
  // AUTHENTICATION
  // ==========================================
  
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [initialAuthView, setInitialAuthView] = useState<'sign_in' | 'sign_up'>('sign_in');

  useEffect(() => {
    if (!supabase) {
      // Allow the app to render in "guest mode" even if Supabase isn't configured
      // (common in preview deployments or first-time Cloudflare Pages setup).
      setUser(null);
      setAuthLoading(false);
      return;
    }

    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowPasswordReset(true);
      }
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  
  // Current step in the flow
  const [currentStep, setCurrentStep] = useState<FlowStep>('start');
  
  // Data from the /api/start-round API
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  
  // The quote the user selected
  const [selectedQuote, setSelectedQuote] = useState<string>('');
  
  // Response from the upload API
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null);

  // Feedback/Analysis from Gemini 2.0 Flash
  const [analysis, setAnalysis] = useState<DebateAnalysis | null>(null);
  const [isFeedbackMock, setIsFeedbackMock] = useState(false);

  // Transcript (needed for saving to DB)
  const [transcript, setTranscript] = useState<string>('');
  const [insufficientReason, setInsufficientReason] = useState<string>('');
  const [insufficientWordCount, setInsufficientWordCount] = useState<number>(0);

  // Show history screen
  const [showHistory, setShowHistory] = useState(false);
  const [showLanding, setShowLanding] = useState(false);

  // Loading state for changing theme
  const [isChangingTheme, setIsChangingTheme] = useState(false);

  // Remaining prep time (passed to RecordScreen)
  const [remainingPrepTime, setRemainingPrepTime] = useState(0);

  // ID of the session currently being viewed in 'ballot' mode
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);

  // ==========================================
  // FLOW HANDLERS
  // ==========================================

  // Dev-only: log step transitions to make debugging flow issues easier
  useEffect(() => {
    console.log(`🧭 Flow step: ${currentStep}`);
  }, [currentStep]);

  // Handle URL routing for direct links and back button
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname;
      if (path.startsWith('/ballot/')) {
        const id = path.split('/ballot/')[1];
        if (id) {
          setViewingSessionId(id);
          setCurrentStep('ballot');
          setShowHistory(false);
        }
      } else if (path === '/') {
        // Only reset if we are currently viewing a ballot or history
        if (currentStep === 'ballot') {
          setCurrentStep('start');
          setViewingSessionId(null);
        }
      }
    };

    // Check on mount
    handleLocationChange();

    // Listen for back/forward
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, [currentStep]);

  /**
   * Called when user selects a session from history
   * Switches to 'ballot' mode to fetch and display that specific session
   */
  const handleHistorySessionSelect = (session: any) => {
    setShowHistory(false);
    setViewingSessionId(session.id);
    setCurrentStep('ballot');
    // Update URL to match
    window.history.pushState(null, '', `/ballot/${session.id}`);
  };

  /**
   * Called when the round data is loaded from the API
   * Move to theme preview step (not directly to quote selection)
   */
  const handleRoundStart = (data: RoundData) => {
    setRoundData(data);
    setCurrentStep('theme-preview');
  };

  /**
   * Called when user wants to change the theme
   * Fetches a new theme from the API
   */
  const handleChangeTheme = async () => {
    setIsChangingTheme(true);
    try {
      const response = await fetch(API_ENDPOINTS.startRound, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data: RoundData = await response.json();
        setRoundData(data);
      }
    } catch (err) {
      console.error('Failed to change theme:', err);
    } finally {
      setIsChangingTheme(false);
    }
  };

  /**
   * Called when user ends pre-round preparation
   * Moves from theme preview to quote selection
   */
  const handleEndPrep = () => {
    setCurrentStep('quote-select');
  };

  /**
   * Called when the user selects a quote
   * Move to prep timer step
   */
  const handleQuoteSelect = (quote: string) => {
    setSelectedQuote(quote);
    setCurrentStep('prep');
  };

  /**
   * Called when the prep timer finishes or user skips
   * Move to recording step, passing remaining time
   */
  const handleTimerComplete = (remainingTime: number = 0) => {
    setRemainingPrepTime(remainingTime);
    setCurrentStep('record');
  };

  /**
   * Called when the video upload is complete
   * Move to processing step
   */
  const handleUploadComplete = (response: UploadResponse) => {
    console.log('📦 Upload complete (frontend):', response);
    setUploadResponse(response);
    setCurrentStep('processing');
  };

  /**
   * Called when all processing is complete and feedback is ready
   * Move to report step
   */
  const handleFeedbackReady = (
    analysisData: DebateAnalysis, 
    isMock: boolean,
    transcriptData: string
  ) => {
    const t = (transcriptData || '').trim();
    const wc = t ? t.split(/\s+/).filter(Boolean).length : 0;

    // Guard: do not proceed to ballot/report if transcript is too short to score competitively.
    if (wc < 25) {
      const hint =
        analysisData?.contentAnalysis?.topicAdherence?.feedback ||
        analysisData?.priorityImprovements?.[0]?.issue ||
        '';
      const match = typeof hint === 'string'
        ? hint.match(/INSUFFICIENT SPEECH DATA:\s*(.+)$/im)
        : null;

      setInsufficientWordCount(wc);
      setInsufficientReason(match?.[1]?.trim() || `Transcript too short to score competitively (${wc} words).`);

      // Ensure we do NOT mount FeedbackReport (which saves to DB) for invalid sessions.
      setAnalysis(null);
      setIsFeedbackMock(false);
      setTranscript(transcriptData);
      setCurrentStep('insufficient');
      return;
    }

    setAnalysis(analysisData);
    setIsFeedbackMock(isMock);
    setTranscript(transcriptData);
    setCurrentStep('report');
  };

  /**
   * Redo the same round with the same quote
   * Goes back to prep timer, keeping the same quote selected
   */
  const handleRedoRound = () => {
    // Clear the upload and feedback, but keep round data and quote
    setUploadResponse(null);
    setAnalysis(null);
    setIsFeedbackMock(false);
    // Go back to prep timer
    setCurrentStep('prep');
  };

  /**
   * Return to homepage (start screen)
   * Resets everything and goes back to start
   */
  const handleGoHome = () => {
    setShowHistory(false);
    setShowLanding(false);
    setCurrentStep('start');
    setRoundData(null);
    setSelectedQuote('');
    setUploadResponse(null);
    setAnalysis(null);
    setIsFeedbackMock(false);
    setTranscript('');
    setViewingSessionId(null);
    // Reset URL
    window.history.pushState(null, '', '/');
  };

  /**
   * Start a new round immediately
   * Fetches new theme and goes directly to theme preview
   */
  const handleNewRound = async () => {
    // Clear previous data
    setSelectedQuote('');
    setUploadResponse(null);
    setAnalysis(null);
    setIsFeedbackMock(false);
    setTranscript('');
    
    // Fetch new round data
    try {
      const response = await fetch(API_ENDPOINTS.startRound, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data: RoundData = await response.json();
        setRoundData(data);
        setCurrentStep('theme-preview');
      } else {
        // Fallback to start screen if fetch fails
        setCurrentStep('start');
        setRoundData(null);
      }
    } catch (err) {
      console.error('Failed to start new round:', err);
      setCurrentStep('start');
      setRoundData(null);
    }
  };

  // ==========================================
  // RENDER CURRENT STEP
  // ==========================================

  /**
   * Render the appropriate component based on current step
   * This is a simple state machine pattern
   */
  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'start':
        // Show the initial start screen
        return (
          <StartScreen 
            onRoundStart={handleRoundStart} 
            onShowHistory={() => setShowHistory(true)}
          />
        );

      case 'theme-preview':
        // Show theme preview (only if we have round data)
        if (!roundData) return null;
        return (
          <ThemePreview
            roundData={roundData}
            onChangeTheme={handleChangeTheme}
            onEndPrep={handleEndPrep}
            isChangingTheme={isChangingTheme}
          />
        );

      case 'quote-select':
        // Show quote selection (only if we have round data)
        if (!roundData) return null;
        return (
          <QuoteSelection
            roundData={roundData}
            onQuoteSelect={handleQuoteSelect}
          />
        );

      case 'prep':
        // Show the preparation timer
        return (
          <PrepTimer
            selectedQuote={selectedQuote}
            durationSeconds={PREP_TIMER_DURATION}
            onTimerComplete={handleTimerComplete}
          />
        );

      case 'record':
        // Show the recording screen with remaining prep time for extended countdown
        return (
          <RecordScreen
            selectedQuote={selectedQuote}
            remainingPrepTime={remainingPrepTime}
            onUploadComplete={handleUploadComplete}
          />
        );

      case 'processing':
        // Show the processing screen
        if (!uploadResponse || !roundData) return null;
        return (
          <UploadSuccess
            uploadResponse={uploadResponse}
            theme={roundData.theme}
            quote={selectedQuote}
            onFeedbackReady={handleFeedbackReady}
          />
        );

      case 'insufficient':
        return (
          <InsufficientSpeech
            wordCount={insufficientWordCount}
            reason={insufficientReason}
            onRedoRound={handleRedoRound}
            onNewRound={handleNewRound}
            onGoHome={handleGoHome}
          />
        );

      case 'report':
        // Show the feedback report (only if we have feedback)
        if (!analysis || !roundData) return null;
        return (
          <FeedbackReport
            analysis={analysis}
            theme={roundData.theme}
            quote={selectedQuote}
            transcript={transcript}
            videoFilename={extractFilename(uploadResponse?.filePath || '')}
            isMock={isFeedbackMock}
            onRedoRound={handleRedoRound}
            onNewRound={handleNewRound}
            onGoHome={handleGoHome}
          />
        );

      case 'ballot':
        // Show specific ballot fetched from DB
        if (!viewingSessionId) return null;
        return (
          <BallotView
            sessionId={viewingSessionId}
            onGoHome={handleGoHome}
            onRedoRound={() => {
              // Redo from history logic: 
              // We'd need to load the quote and start prep.
              // For now, simpler to just start new or go home.
              handleGoHome();
            }}
            onNewRound={handleNewRound}
            onNavigate={(id) => {
              setViewingSessionId(id);
              window.history.pushState(null, '', `/ballot/${id}`);
            }}
          />
        );

      default:
        return (
          <StartScreen 
            onRoundStart={handleRoundStart} 
            onShowHistory={() => setShowHistory(true)}
          />
        );
    }
  };

  // ==========================================
  // AUTH LOADING/ERROR STATES
  // ==========================================

  // Show loading spinner while checking auth
  if (authLoading) {
    return (
      <div style={styles.app}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <p style={styles.loadingText}>Loading...</p>
        </div>
      </div>
    );
  }

  // Show login screen or landing page if not authenticated
  if (!user) {
    if (showLogin) {
      return (
        <Login 
          initialView={initialAuthView} 
          onBack={() => setShowLogin(false)} 
        />
      );
    }
    return (
      <div style={{...styles.app, paddingTop: '64px'}}>
        <Navbar
          user={null}
          onNavigateToLanding={() => {}} // Already on landing
          onNavigateToDashboard={() => {}} // No dashboard for guest
          onNavigateToHistory={() => {}} // No history for guest
          onSignIn={() => {
            setInitialAuthView('sign_in');
            setShowLogin(true);
          }}
        />
        {!isSupabaseConfigured && (
          <div style={styles.envBanner}>
            <strong>Setup required:</strong> Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your Cloudflare Pages environment variables.
          </div>
        )}
        <LandingPage
          onStart={() => {
            setInitialAuthView('sign_in');
            setShowLogin(true);
          }}
          onSignIn={() => {
            setInitialAuthView('sign_in');
            setShowLogin(true);
          }}
        />
      </div>
    );
  }

  // Show Password Reset screen if the user is in recovery mode
  if (showPasswordReset) {
    return <UpdatePassword onSuccess={() => setShowPasswordReset(false)} />;
  }

  // Show Landing Page if authenticated but showLanding is true
  if (showLanding) {
    return (
      <div style={{...styles.app, paddingTop: '64px'}}>
        <Navbar
          user={user}
          onNavigateToLanding={() => {}} // Stay on landing
          onNavigateToDashboard={handleGoHome}
          onNavigateToHistory={() => { setShowLanding(false); setShowHistory(true); }}
          onSignOut={() => supabase?.auth.signOut()}
        />
        
        {/* Render Landing Page Content */}
        <LandingPage
          onStart={handleGoHome} // "Start Training Session" goes to Dashboard
          onSignIn={() => {}} // Should not happen
          isAuthenticated={true}
          userEmail={user.email}
          onSignOut={() => supabase?.auth.signOut()}
          onDashboardClick={handleGoHome}
          onHistoryClick={() => { setShowLanding(false); setShowHistory(true); }}
        />
      </div>
    );
  }

  // ==========================================
  // MAIN RENDER (AUTHENTICATED APP)
  // ==========================================

  // Determine if navbar is disabled or hidden
  const isNavDisabled = currentStep === 'processing';
  const shouldHideNav = currentStep === 'record';

  return (
    <div style={{...styles.app, paddingTop: shouldHideNav ? 0 : '64px'}}>
      {!shouldHideNav && (
        <Navbar
          user={user}
          onNavigateToLanding={() => setShowLanding(true)}
          onNavigateToDashboard={handleGoHome}
          onNavigateToHistory={() => setShowHistory(true)}
          onSignOut={() => supabase?.auth.signOut()}
          disabled={isNavDisabled}
        />
      )}

      {/* Render the current step or history */}
      {showHistory ? (
        <History onClose={() => setShowHistory(false)} onSelectSession={handleHistorySessionSelect} />
      ) : (
        renderCurrentStep()
      )}
    </div>
  );
}

// ==========================================
// STYLES
// ==========================================

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    background: '#ffffff',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    position: 'relative',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #e5e5e5',
    borderTop: '3px solid #111111',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    color: '#666666',
    marginTop: '16px',
    fontSize: '1rem',
  },
  envBanner: {
    maxWidth: '1280px',
    margin: '16px auto 0',
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid #fbbf24',
    background: '#fffbeb',
    color: '#92400e',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    lineHeight: 1.4,
  },
};

export default App;
