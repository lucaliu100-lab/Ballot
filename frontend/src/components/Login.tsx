/**
 * Login Component
 * 
 * Handles user authentication using InstantDB's magic link (email code) flow:
 * 1. User enters their email
 * 2. InstantDB sends a verification code to their email
 * 3. User enters the code to log in
 * 
 * This creates a user account automatically if one doesn't exist.
 */

import { useState } from 'react';
import { db } from '../lib/instant';

function Login() {
  // ===========================================
  // STATE
  // ===========================================
  
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ===========================================
  // HANDLERS
  // ===========================================

  /**
   * Send the magic code to the user's email
   */
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await db.auth.sendMagicCode({ email: email.trim() });
      setCodeSent(true);
    } catch (err) {
      console.error('Failed to send code:', err);
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Verify the code and log the user in
   */
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!code.trim()) {
      setError('Please enter the verification code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await db.auth.signInWithMagicCode({ email: email.trim(), code: code.trim() });
      // On success, the auth state will update automatically
      // and App.tsx will render the main app instead of Login
    } catch (err) {
      console.error('Failed to verify code:', err);
      setError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Go back to email entry (if user wants to change email)
   */
  const handleChangeEmail = () => {
    setCodeSent(false);
    setCode('');
    setError(null);
  };

  // ===========================================
  // RENDER
  // ===========================================

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Speech Practice</h1>
        <p style={styles.subtitle}>
          {codeSent 
            ? 'Check your email for a verification code'
            : 'Sign in to track your practice sessions'
          }
        </p>
      </div>

      <div style={styles.formContainer}>
        {/* Error message */}
        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}

        {/* Email form (step 1) */}
        {!codeSent && (
          <form onSubmit={handleSendCode} style={styles.form}>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={styles.input}
              disabled={isLoading}
              autoFocus
            />
            <button 
              type="submit" 
              style={styles.button}
              disabled={isLoading || !email.trim()}
            >
              {isLoading ? 'Sending...' : 'Send Verification Code'}
            </button>
          </form>
        )}

        {/* Code verification form (step 2) */}
        {codeSent && (
          <form onSubmit={handleVerifyCode} style={styles.form}>
            <div style={styles.emailSentTo}>
              Code sent to: <strong>{email}</strong>
              <button 
                type="button"
                onClick={handleChangeEmail}
                style={styles.changeEmailButton}
              >
                Change
              </button>
            </div>
            
            <label style={styles.label}>Verification Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter 6-digit code"
              style={styles.input}
              disabled={isLoading}
              autoFocus
              maxLength={6}
            />
            <button 
              type="submit" 
              style={styles.button}
              disabled={isLoading || !code.trim()}
            >
              {isLoading ? 'Verifying...' : 'Sign In'}
            </button>
            
            <button
              type="button"
              onClick={handleSendCode}
              style={styles.resendButton}
              disabled={isLoading}
            >
              Resend Code
            </button>
          </form>
        )}

        {/* Footer info */}
        <p style={styles.footerText}>
          By signing in, you can save your practice sessions and track your improvement over time.
        </p>
      </div>
    </div>
  );
}

// ===========================================
// STYLES
// ===========================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    padding: '80px 48px 120px 48px',
    background: '#ffffff',
  },
  header: {
    marginBottom: '48px',
  },
  title: {
    color: '#111111',
    fontSize: '3rem',
    margin: '0 0 12px 0',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#666666',
    fontSize: '1.1rem',
    margin: 0,
    lineHeight: 1.5,
  },
  formContainer: {
    maxWidth: '400px',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #dc2626',
    color: '#dc2626',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '24px',
    fontSize: '0.95rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  label: {
    color: '#333333',
    fontSize: '0.95rem',
    textAlign: 'left',
    marginBottom: '-8px',
    fontWeight: 500,
  },
  input: {
    background: '#ffffff',
    border: '2px solid #000000',
    borderRadius: '8px',
    padding: '14px 16px',
    fontSize: '1rem',
    color: '#111111',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  button: {
    background: '#000000',
    color: '#ffffff',
    border: '2px solid #000000',
    padding: '16px 24px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginTop: '8px',
  },
  emailSentTo: {
    color: '#333333',
    fontSize: '0.95rem',
    padding: '16px',
    background: '#fafafa',
    border: '1px solid #e5e5e5',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  changeEmailButton: {
    background: 'transparent',
    border: 'none',
    color: '#000000',
    cursor: 'pointer',
    fontSize: '0.9rem',
    textDecoration: 'underline',
    padding: '0 4px',
  },
  resendButton: {
    background: '#ffffff',
    border: '2px solid #000000',
    color: '#333333',
    padding: '12px 20px',
    fontSize: '0.95rem',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  footerText: {
    color: '#666666',
    fontSize: '0.85rem',
    marginTop: '32px',
    lineHeight: 1.5,
  },
};

export default Login;

