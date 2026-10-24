import React, { useState } from 'react';

interface LoginPageProps {
  onSuccess: (token: string) => void;
  onBackToLanding: () => void;
}

export function LoginPage({ onSuccess, onBackToLanding }: LoginPageProps) {
  const [email, setEmail] = useState('admin@haxatax.fr');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: { message?: string } };
        setError(err.error?.message ?? 'Identifiants invalides. Vérifiez votre email et mot de passe.');
        return;
      }
      const data = await res.json() as { token: string };
      try { localStorage.setItem('hx_token', data.token); } catch {}
      onSuccess(data.token);
    } catch {
      setError('Erreur de connexion au serveur. Vérifiez votre connexion réseau.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lp-root">
      <div className="lp-card">
        <div className="lp-brand">
          <div className="lp-logo-mark" aria-hidden="true">H</div>
          <h1 className="lp-brand-name">haxatax</h1>
          <p className="lp-brand-tagline">Votre espace comptable sécurisé</p>
        </div>

        <form onSubmit={handleSubmit} noValidate aria-label="Connexion à votre compte">
          {error && (
            <div role="alert" id="lp-error" className="lp-alert">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#dc2626" strokeWidth="1.5" />
                <path d="M8 5v3M8 10.5v.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          <div className="lp-field">
            <label htmlFor="lp-email" className="lp-label">Adresse e-mail</label>
            <input
              id="lp-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username email"
              autoFocus
              className="lp-input"
              placeholder="vous@cabinet.fr"
              aria-describedby={error ? 'lp-error' : undefined}
            />
          </div>

          <div className="lp-field">
            <label htmlFor="lp-password" className="lp-label">Mot de passe</label>
            <input
              id="lp-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="lp-input"
              aria-describedby={error ? 'lp-error' : undefined}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="lp-submit"
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className="lp-spinner" aria-hidden="true" />
                Connexion en cours…
              </>
            ) : (
              <>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M11 11l3-3-3-3M14 8H6"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Se connecter
              </>
            )}
          </button>
        </form>

        <div className="lp-demo-hint" role="note" aria-label="Identifiants de démonstration">
          <span className="lp-demo-label">Démo</span>
          <code>admin@haxatax.fr</code>
          <span className="lp-demo-sep" aria-hidden="true">/</span>
          <code>Haxatax2026!</code>
        </div>

        <button type="button" onClick={onBackToLanding} className="lp-back">
          ← Retour à l'accueil
        </button>
      </div>
    </div>
  );
}
