import React, { useState } from 'react';

interface LandingPageProps {
  onStart: () => void;
  onSignIn: () => void;
  isAuthenticated?: boolean;
  userEmail?: string;
  onSignOut?: () => void;
  onDashboardClick?: () => void;
  onHistoryClick?: () => void;
}

function LandingPage({ 
  onStart, 
}: LandingPageProps) {
  const [hoverPrimary, setHoverPrimary] = useState(false);
  const [hoverFooter, setHoverFooter] = useState(false);

  const Divider = () => (
    <div style={{
      width: '100%',
      maxWidth: '1280px',
      height: '1px',
      background: '#f3f4f6', // Light gray
      margin: '60px 0',
    }} />
  );

  return (
    <div style={styles.container} className="landing-page">
      {/* Navbar is now handled by parent App component */}

      {/* Hero Section */}
      <div style={styles.heroSection}>
        <h1 style={styles.headline}>Elevate Your Competitive Debating</h1>
        <p style={styles.subtitle}>
          A professional training platform for competitive debaters with AI-powered performance analysis for tournament preparation.
        </p>

        <div style={styles.buttonGroup}>
          <button
            onClick={onStart}
            onMouseEnter={() => setHoverPrimary(true)}
            onMouseLeave={() => setHoverPrimary(false)}
            style={{
              ...styles.primaryButton,
              ...(hoverPrimary ? styles.primaryButtonHover : {}),
            }}
          >
            Start Training Session
          </button>
        </div>
      </div>

      <Divider />

      {/* Judging System Section */}
      <div style={styles.contentSection}>
        <h2 style={styles.sectionTitle}>Judging System</h2>
        <p style={styles.sectionDesc}>
          The platform uses NSDA standard impromptu evaluation criteria with multimodal AI analysis of video, audio, transcript, and body language to provide tournament-grade feedback.
        </p>

        <div className="grid-container" style={styles.gridContainer}>
          <div style={styles.gridItem}>
            <div style={styles.categoryName}>Content</div>
            <div style={styles.categoryWeight}>40% weight</div>
          </div>
          <div style={styles.gridItem}>
            <div style={styles.categoryName}>Delivery</div>
            <div style={styles.categoryWeight}>30% weight</div>
          </div>
          <div style={styles.gridItem}>
            <div style={styles.categoryName}>Language</div>
            <div style={styles.categoryWeight}>15% weight</div>
          </div>
          <div style={styles.gridItem}>
            <div style={styles.categoryName}>Body Language</div>
            <div style={styles.categoryWeight}>15% weight</div>
          </div>
        </div>

        <p style={styles.standardsText}>
          System maintains strict tournament standards including length validation where speeches under 3 minutes receive content penalties, filler word tracking with counts per minute, and comprehensive structural analysis of arguments, transitions, and conclusions.
        </p>
      </div>

      <Divider />

      {/* Performance Tiers Section */}
      <div style={styles.contentSection}>
        <h2 style={styles.sectionTitle}>Performance Tiers</h2>
        
        <div style={styles.tiersList}>
          <div style={styles.tierItem}>
             <div style={{...styles.tierSquare, background: '#22c55e'}}></div>
             <div style={styles.tierInfo}>
               <span style={styles.tierName}>Finals Ready</span>
               <span style={styles.tierRange}>9.0 - 10.0</span>
             </div>
          </div>
          <div style={styles.tierItem}>
             <div style={{...styles.tierSquare, background: '#3b82f6'}}></div>
             <div style={styles.tierInfo}>
               <span style={styles.tierName}>Semifinals Ready</span>
               <span style={styles.tierRange}>8.0 - 8.9</span>
             </div>
          </div>
          <div style={styles.tierItem}>
             <div style={{...styles.tierSquare, background: '#eab308'}}></div>
             <div style={styles.tierInfo}>
               <span style={styles.tierName}>Quarterfinals Ready</span>
               <span style={styles.tierRange}>6.5 - 7.9</span>
             </div>
          </div>
          <div style={styles.tierItem}>
             <div style={{...styles.tierSquare, background: '#9ca3af'}}></div>
             <div style={styles.tierInfo}>
               <span style={styles.tierName}>Local Round Ready</span>
               <span style={styles.tierRange}>Below 6.5</span>
             </div>
          </div>
        </div>
      </div>

      <Divider />

      {/* How It Works Section */}
      <div style={styles.contentSection}>
        <h2 style={styles.sectionTitle}>How It Works</h2>
        <div style={styles.stepsList}>
          <div style={styles.stepItem}>
            <div style={styles.stepCircle}>1</div>
            <div style={styles.stepText}>Get a theme and 3 inspiring quotes</div>
          </div>
          <div style={styles.stepItem}>
            <div style={styles.stepCircle}>2</div>
            <div style={styles.stepText}>Select the quote that resonates with you</div>
          </div>
          <div style={styles.stepItem}>
            <div style={styles.stepCircle}>3</div>
            <div style={styles.stepText}>Prepare your thoughts for 2 minutes</div>
          </div>
          <div style={styles.stepItem}>
            <div style={styles.stepCircle}>4</div>
            <div style={styles.stepText}>Record your speech on camera</div>
          </div>
        </div>
      </div>

      <Divider />

      {/* Footer Call to Action */}
      <div style={styles.footerSection}>
        <p style={styles.footerText}>Ready to begin your tournament preparation journey</p>
        <button
          onClick={onStart}
          onMouseEnter={() => setHoverFooter(true)}
          onMouseLeave={() => setHoverFooter(false)}
          style={{
            ...styles.primaryButton,
            ...(hoverFooter ? styles.primaryButtonHover : {}),
          }}
        >
          Start Training Session
        </button>
      </div>

      {/* Bottom Spacer */}
      <div style={{ height: '80px' }} />

      {/* Responsive Styles */}
      <style>{`
        @media (max-width: 768px) {
          .landing-page {
            padding: 0 16px !important;
          }
          .grid-container {
            grid-template-columns: 1fr !important;
            border-bottom: 1px solid #e5e7eb;
          }
          .hero-section {
            padding-top: 120px !important;
            padding-bottom: 60px !important;
          }
          .logo {
            font-size: 18px !important;
          }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    width: '100%',
    background: '#ffffff',
    backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)',
    backgroundSize: '32px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: '0 24px',
  },
  // Removed navbar styles
  heroSection: {
    maxWidth: '1280px',
    width: '100%',
    paddingTop: '96px', // Adjusted to account for fixed navbar (64px handled by App padding) + extra visual space
    // App uses padding-top 64px, so this 96px is ADDITIONAL to that. 
    // Wait, App has paddingTop: 64px. So LandingPage starts at y=64px.
    // If we want 160px visual from top, we need 96px here.
    // However, in "unauthenticated" mode App also adds padding-top 64px.
    // So 96px is correct relative to the container start.
    paddingBottom: '60px', 
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  headline: {
    fontSize: '48px',
    fontWeight: 700,
    color: '#000000',
    margin: '0 0 24px 0',
    lineHeight: 1.1,
  },
  subtitle: {
    fontSize: '20px',
    color: '#6b7280',
    margin: '0 0 48px 0',
    maxWidth: '800px',
    lineHeight: 1.5,
  },
  buttonGroup: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '32px',
  },
  primaryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '18px 40px',
    fontSize: '1.1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  },
  primaryButtonHover: {
    background: '#222222',
    transform: 'translateY(-2px)',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  },
  
  // Content Sections
  contentSection: {
    maxWidth: '1000px',
    width: '100%',
    marginBottom: '0', // Margin handled by dividers
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#000000',
    marginTop: '40px',
    marginBottom: '24px',
  },
  sectionDesc: {
    fontSize: '16px',
    color: '#6b7280',
    maxWidth: '800px',
    marginBottom: '40px',
    lineHeight: 1.6,
  },
  
  // Grid
  gridContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    width: '100%',
    gap: '0',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    marginBottom: '40px',
    overflow: 'hidden',
  },
  gridItem: {
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    borderRight: '1px solid #e5e7eb',
    background: '#f9fafb', // Light gray background
  },
  categoryName: {
    fontWeight: 700,
    fontSize: '16px',
    color: '#000000',
    marginBottom: '8px',
  },
  categoryWeight: {
    fontSize: '14px',
    color: '#6b7280',
  },
  
  standardsText: {
    fontSize: '16px',
    color: '#6b7280',
    maxWidth: '800px',
    lineHeight: 1.6,
  },

  // Tiers
  tiersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px', // Increased spacing
    width: '100%',
    maxWidth: '400px',
  },
  tierItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    background: '#ffffff',
  },
  tierSquare: {
    width: '16px',
    height: '16px',
    borderRadius: '3px',
    flexShrink: 0,
    marginRight: '2px', // Added 2px spacing specifically as requested
  },
  tierInfo: {
    display: 'flex',
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tierName: {
    fontWeight: 700,
    fontSize: '16px',
    color: '#000000',
  },
  tierRange: {
    fontSize: '14px',
    color: '#6b7280',
  },

  // How It Works
  stepsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    width: '100%',
    maxWidth: '500px',
    textAlign: 'left',
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  stepCircle: {
    width: '32px',
    height: '32px',
    borderRadius: '16px',
    border: '1px solid #000000',
    background: '#ffffff',
    color: '#000000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 600,
    fontSize: '14px',
    flexShrink: 0,
  },
  stepText: {
    fontSize: '16px',
    color: '#374151', // Dark gray
  },

  // Footer
  footerSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
    marginBottom: '40px',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
  },
};

export default LandingPage;
