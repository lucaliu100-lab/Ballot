/**
 * UpdatePassword Component
 * 
 * Allows a logged-in user to set a new password.
 * Typically used after clicking a "Forgot Password" reset link.
 */

import { useState } from 'react';
import { supabase } from '../lib/supabase';

interface UpdatePasswordProps {
  onSuccess: () => void;
}

function UpdatePassword({ onSuccess }: UpdatePasswordProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return setError('Please enter a new password');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirmPassword) return setError('Passwords do not match');

    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;
      
      // Notify parent to switch view back to main app
      onSuccess();
    } catch (err) {
      console.error('Update password error:', err);
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.formCard}>
        <h1 style={styles.title}>Set New Password</h1>
        <p style={styles.subtitle}>Please enter your new password below.</p>

        {error && <div style={styles.errorBox}>{error}</div>}

        <form onSubmit={handleUpdatePassword} style={styles.form}>
          <label style={styles.label}>New Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 6 characters"
            style={styles.input}
            disabled={isLoading}
          />

          <label style={styles.label}>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            style={styles.input}
            disabled={isLoading}
          />

          <button 
            type="submit" 
            style={styles.primaryButton}
            disabled={isLoading}
          >
            {isLoading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: '#ffffff',
    padding: '20px',
  },
  formCard: {
    width: '100%',
    maxWidth: '400px',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 700,
    color: '#111',
    marginBottom: '8px',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '1rem',
    color: '#666',
    marginBottom: '32px',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: '#333',
    marginBottom: '-8px',
  },
  input: {
    padding: '12px 16px',
    fontSize: '1rem',
    borderRadius: '8px',
    border: '1px solid #e5e5e5',
    outline: 'none',
  },
  primaryButton: {
    background: '#000',
    color: '#fff',
    border: 'none',
    padding: '14px',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '16px',
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
};

export default UpdatePassword;

