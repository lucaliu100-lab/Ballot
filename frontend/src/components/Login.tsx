/**
 * Login Component
 * 
 * Supports:
 * 1. OAuth (Google, Microsoft)
 * 2. Email/Password (Sign In, Sign Up)
 * 3. Password Reset (Forgot Password)
 */

import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { getPublicSiteOrigin } from '../lib/url';

type AuthView = 'sign_in' | 'sign_up' | 'forgot_password';

interface LoginProps {
  initialView?: AuthView;
  onBack?: () => void;
}

function Login({ initialView = 'sign_in', onBack }: LoginProps) {
  // ===========================================
  // STATE
  // ===========================================
  
  const [view, setView] = useState<AuthView>(initialView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ===========================================
  // HANDLERS
  // ===========================================

  const handleGoogleLogin = async () => {
    if (!supabase) {
      setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment.');
      return;
    }
    try {
      const siteOrigin = getPublicSiteOrigin() || window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: siteOrigin }
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in with Google');
    }
  };

  /* Microsoft login temporarily disabled
  const handleMicrosoftLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'azure', 
        options: {
          scopes: 'email',
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in with Microsoft');
    }
  };
  */

  const handleEmailPasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment.');
    if (!email || !password) return setError('Please fill in all fields');

    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment.');
    if (!email || !password) return setError('Please fill in all fields');
    if (!fullName.trim()) return setError('Please enter your full name');

    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });
      if (error) throw error;
      
      // If auto-confirm is on, session will be present
      if (data.session) {
        // App.tsx will detect the session change and log us in automatically
        return; 
      }

      // If we get here, it means Supabase is still waiting for email confirmation
      setMessage('Account created, but Supabase requires email confirmation. Please go to your Supabase Dashboard -> Auth -> Providers -> Email and disable "Confirm email".');
      setView('sign_in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment.');
    if (!email) return setError('Please enter your email address');

    setIsLoading(true);
    setError(null);
    try {
      const siteOrigin = getPublicSiteOrigin() || window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteOrigin}/update-password`,
      });
      if (error) throw error;
      setMessage('Password reset link sent! Check your email.');
      setView('sign_in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  // ===========================================
  // RENDER HELPERS
  // ===========================================

  const renderOAuthButtons = () => (
    <>
      <button
        type="button"
        onClick={handleGoogleLogin}
        style={styles.oauthButton}
      >
        <img src="https://www.google.com/favicon.ico" alt="Google" style={styles.oauthIcon} />
        Sign in with Google
      </button>
      {/* 
      <button
        type="button"
        onClick={handleMicrosoftLogin}
        style={styles.oauthButton}
      >
        <svg style={styles.oauthIcon} viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>
        Sign in with Microsoft
      </button>
      */}
    </>
  );

  return (
    <div style={styles.container}>
      {onBack && (
        <button onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      )}
      <div style={styles.header}>
        <h1 style={styles.title}>Speech Practice</h1>
        <p style={styles.subtitle}>
          {view === 'sign_up' ? 'Create a new account' : 
           view === 'forgot_password' ? 'Reset your password' : 
           'Sign in to track your progress'}
        </p>
      </div>

      <div style={styles.formContainer}>
        {error && <div style={styles.errorBox}>{error}</div>}
        {message && <div style={styles.messageBox}>{message}</div>}

        {/* VIEW: SIGN IN */}
        {view === 'sign_in' && (
          <>
            {renderOAuthButtons()}
            
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>OR</span>
              <div style={styles.dividerLine} />
            </div>

            <form onSubmit={handleEmailPasswordLogin} style={styles.form}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=""
                style={styles.input}
                disabled={isLoading}
              />
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                style={styles.input}
                disabled={isLoading}
              />
              <div style={{ textAlign: 'right', marginTop: '-8px' }}>
                <button 
                  type="button" 
                  onClick={() => { setView('forgot_password'); setError(null); }}
                  style={styles.linkButton}
                >
                  Forgot password?
                </button>
          </div>
              <button 
                type="submit" 
                style={styles.primaryButton}
                disabled={isLoading}
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <p style={styles.footerText}>
              Don't have an account?{' '}
              <button 
                onClick={() => { setView('sign_up'); setError(null); }}
                style={styles.linkButtonBold}
              >
                Sign up
              </button>
            </p>
          </>
        )}

        {/* VIEW: SIGN UP */}
        {view === 'sign_up' && (
          <>
            {renderOAuthButtons()}
            
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>OR</span>
              <div style={styles.dividerLine} />
            </div>

            <form onSubmit={handleSignUp} style={styles.form}>
              <label style={styles.label}>Full Name <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder=""
                style={styles.input}
                disabled={isLoading}
                required
              />
              <label style={styles.label}>Email Address <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder=""
                style={styles.input}
                disabled={isLoading}
                required
              />
              <label style={styles.label}>Create Password <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder=""
                style={styles.input}
                disabled={isLoading}
                required
              />
              <button 
                type="submit" 
                style={styles.primaryButton}
                disabled={isLoading}
              >
                {isLoading ? 'Creating Account...' : 'Sign Up'}
              </button>
            </form>

            <p style={styles.footerText}>
              Already have an account?{' '}
              <button 
                onClick={() => { setView('sign_in'); setError(null); }}
                style={styles.linkButtonBold}
              >
                Sign in
              </button>
            </p>
          </>
        )}

        {/* VIEW: FORGOT PASSWORD */}
        {view === 'forgot_password' && (
          <form onSubmit={handleResetPassword} style={styles.form}>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '16px' }}>
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder=""
              style={styles.input}
              disabled={isLoading}
            />
            <button 
              type="submit" 
              style={styles.primaryButton}
              disabled={isLoading}
            >
              {isLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
            
            <button
              type="button"
              onClick={() => { setView('sign_in'); setError(null); }}
              style={styles.secondaryButton}
              disabled={isLoading}
            >
              Back to Sign In
            </button>
          </form>
        )}
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
    padding: '80px 24px',
    background: '#ffffff',
    alignItems: 'center',
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    top: '32px',
    left: '32px',
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  header: {
    marginBottom: '40px',
    textAlign: 'center',
  },
  title: {
    color: '#111111',
    fontSize: '2.5rem',
    margin: '0 0 12px 0',
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#666666',
    fontSize: '1.1rem',
    margin: 0,
  },
  formContainer: {
    width: '100%',
    maxWidth: '400px',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #dc2626',
    color: '#dc2626',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '0.9rem',
  },
  messageBox: {
    background: '#f0fdf4',
    border: '1px solid #16a34a',
    color: '#16a34a',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '0.9rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  label: {
    color: '#333333',
    fontSize: '0.9rem',
    fontWeight: 500,
    marginBottom: '-8px',
  },
  input: {
    background: '#f9fafb',
    border: '1.5px solid #666666',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '1rem',
    color: '#111111',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  primaryButton: {
    background: '#000000',
    color: '#ffffff',
    border: 'none',
    padding: '14px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    marginTop: '8px',
  },
  secondaryButton: {
    background: 'transparent',
    color: '#000000',
    border: '1px solid #e5e5e5',
    padding: '14px',
    fontSize: '1rem',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: 'pointer',
  },
  oauthButton: {
    background: '#ffffff',
    color: '#333333',
    border: '1.5px solid #666666',
    padding: '12px',
    fontSize: '0.95rem',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    marginBottom: '12px',
  },
  oauthIcon: {
    width: '20px',
    height: '20px',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    margin: '24px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: '#e5e5e5',
  },
  dividerText: {
    color: '#999',
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  footerText: {
    textAlign: 'center',
    color: '#666',
    fontSize: '0.9rem',
    marginTop: '24px',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '0.85rem',
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0,
  },
  linkButtonBold: {
    background: 'none',
    border: 'none',
    color: '#000',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0,
  },
};

export default Login;
