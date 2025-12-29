import React, { useState } from 'react';

interface NavbarProps {
  user: any | null;
  onNavigateToLanding: () => void;
  onNavigateToDashboard: () => void;
  onNavigateToHistory: () => void;
  onSignIn?: () => void;
  onSignOut?: () => void;
  disabled?: boolean;
}

const Navbar: React.FC<NavbarProps> = ({
  user,
  onNavigateToLanding,
  onNavigateToDashboard,
  onNavigateToHistory,
  onSignIn,
  onSignOut,
  disabled = false,
}) => {
  const [isLogoHover, setIsLogoHover] = useState(false);
  const [isDashboardHover, setIsDashboardHover] = useState(false);
  const [isHistoryHover, setIsHistoryHover] = useState(false);
  const [isSignOutHover, setIsSignOutHover] = useState(false);
  const [isSignInHover, setIsSignInHover] = useState(false);

  return (
    <div style={styles.navbar}>
      {/* Left Side: Logo and Dashboard Link */}
      <div style={styles.leftSection}>
        <button
          onClick={onNavigateToLanding}
          onMouseEnter={() => setIsLogoHover(true)}
          onMouseLeave={() => setIsLogoHover(false)}
          style={{
            ...styles.logoButton,
            opacity: isLogoHover ? 0.8 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
          disabled={disabled}
        >
          BALLOT
        </button>

        {user && (
          <button
            onClick={onNavigateToDashboard}
            onMouseEnter={() => setIsDashboardHover(true)}
            onMouseLeave={() => setIsDashboardHover(false)}
            style={{
              ...styles.dashboardLink,
              color: isDashboardHover ? '#111827' : '#4b5563', // gray-900 vs gray-600
              borderBottom: isDashboardHover ? '1px solid #111827' : '1px solid transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
            disabled={disabled}
          >
            Dashboard
          </button>
        )}
      </div>

      {/* Spacer to push right items */}
      <div style={{ flex: 1 }} />

      {/* Right Side: History, User, Auth */}
      <div style={styles.rightSection}>
        {user ? (
          <>
            <button
              onClick={onNavigateToHistory}
              onMouseEnter={() => setIsHistoryHover(true)}
              onMouseLeave={() => setIsHistoryHover(false)}
              style={{
                ...styles.historyButton,
                opacity: disabled ? 0.5 : (isHistoryHover ? 0.9 : 1),
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              disabled={disabled}
              title={disabled ? 'Finish current task first' : 'Open History'}
            >
              History / Progress
            </button>
            
            <span style={styles.userEmail}>{user.email}</span>
            
            <button
              onClick={onSignOut}
              onMouseEnter={() => setIsSignOutHover(true)}
              onMouseLeave={() => setIsSignOutHover(false)}
              style={{
                ...styles.signOutButton,
                background: isSignOutHover ? '#f9fafb' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <button
            onClick={onSignIn}
            onMouseEnter={() => setIsSignInHover(true)}
            onMouseLeave={() => setIsSignInHover(false)}
            style={{
              ...styles.signInLink,
              color: isSignInHover ? '#111827' : '#4b5563',
              textDecoration: isSignInHover ? 'underline' : 'none',
            }}
          >
            Sign In
          </button>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  navbar: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '64px', // Fixed height ensures consistent layout
    background: '#ffffff',
    borderBottom: '1px solid #e5e7eb', // border-gray-200
    display: 'flex',
    alignItems: 'center',
    padding: '0 24px', // 16px vertical handled by flex center + fixed height? No, user asked for padding 16px vertical.
    // If we use fixed height 64px, explicit padding might overconstrain. 
    // Let's use box-sizing border-box if possible, but style object doesn't include global reset.
    // Ideally, height 64px with align-items center is sufficient.
    // If strict 16px vertical padding is required:
    // padding: '16px 24px', 
    // But then height might vary.
    // User asked for "padding of 16 pixels vertical". 
    // Let's assume height 64px covers it visually (approx 16px top/bottom if content is ~32px).
    // Or we can set height: 'auto' and padding: '16px 24px'.
    // BUT we want consistent position. 'auto' height depends on content.
    // Fixed height is safer for "exact same position".
    zIndex: 100,
    boxSizing: 'border-box',
  },
  leftSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '32px', // Enforce 32px spacing
  },
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px', // Reasonable gap for right items
  },
  logoButton: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    fontWeight: 800,
    color: '#000000',
    letterSpacing: '0.05em',
    padding: 0,
    transition: 'opacity 0.2s',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  dashboardLink: {
    background: 'none',
    border: 'none',
    fontSize: '15px',
    fontWeight: 500,
    padding: '4px 0',
    transition: 'color 0.2s, border-bottom 0.2s',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  historyButton: {
    background: '#000000',
    color: '#ffffff',
    border: '1px solid #000000',
    padding: '6px 12px',
    fontSize: '0.8rem',
    borderRadius: '6px',
    transition: 'opacity 0.2s',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  userEmail: {
    color: '#666666',
    fontSize: '0.85rem',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  signOutButton: {
    background: '#ffffff',
    color: '#333333',
    border: '1px solid #000000',
    padding: '6px 12px',
    fontSize: '0.8rem',
    borderRadius: '6px',
    transition: 'background-color 0.2s',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  signInLink: {
    background: 'none',
    border: 'none',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
    padding: '8px',
    transition: 'color 0.2s ease',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
};

export default Navbar;

