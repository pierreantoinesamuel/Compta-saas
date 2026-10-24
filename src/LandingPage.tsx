import React from 'react';

interface LandingPageProps {
  onLoginClick: () => void;
}

// ── Feature cards ──────────────────────────────────────────────────────────

const FEATURES = [
  {
    title: 'Facturation Factur-X',
    desc: 'Factures standard, acomptes et avoirs avec numérotation gapless conforme EN 16931 et génération PDF intégrée.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: 'Rapprochement bancaire',
    desc: 'Importez vos relevés, lettrez les écritures automatiquement et clôturez vos périodes comptables en toute sérénité.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    title: 'OCR & Agent Phacet',
    desc: "Glissez vos factures fournisseurs. Phacet extrait les données, détecte les anomalies d'IBAN et protège contre la fraude au virement.",
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    title: 'Export FEC & DGFiP',
    desc: "Export FEC certifié, journal d'audit inaltérable avec chaîne de hachage SHA-256, TVA multi-taux et Grand Livre PCG 2025.",
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    title: 'Gestion des tiers',
    desc: 'Clients et fournisseurs avec SIREN/SIRET, IBAN certifié, TVA intracommunautaire et codes auxiliaires PCG.',
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    title: 'Tableau de bord',
    desc: "Vue d'ensemble en temps réel : CA, TVA collectée, factures en attente, soldes bancaires et alertes de conformité.",
    icon: (
      <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
];

// ── Pricing tiers ──────────────────────────────────────────────────────────

const PLANS = [
  {
    name: 'Starter',
    price: 'Gratuit',
    period: 'pour toujours',
    desc: 'Idéal pour démarrer et tester la plateforme.',
    features: [
      'Jusqu\'à 20 factures/mois',
      '1 dossier comptable',
      'Export FEC',
      'TVA multi-taux',
      'Support communauté',
    ],
    cta: 'Commencer gratuitement',
    highlight: false,
  },
  {
    name: 'PME',
    price: '29 €',
    period: '/mois HT',
    desc: 'Pour les PME et indépendants qui veulent aller vite.',
    features: [
      'Factures illimitées',
      '3 dossiers comptables',
      'OCR & agent Phacet',
      'Rapprochement bancaire',
      'Détection fraude IBAN',
      'Export Factur-X PDF',
      'Support email prioritaire',
    ],
    cta: 'Choisir PME',
    highlight: true,
  },
  {
    name: 'Cabinet',
    price: '79 €',
    period: '/mois HT',
    desc: 'Pour les experts-comptables et cabinets multi-clients.',
    features: [
      'Dossiers illimités',
      'Multi-utilisateurs',
      'API REST complète',
      'Audit log inaltérable',
      'Grand Livre PCG 2025',
      'Intégration Mailjet',
      'Support dédié SLA',
    ],
    cta: 'Contacter l\'équipe',
    highlight: false,
  },
];

// ── Dashboard mockup ───────────────────────────────────────────────────────

function DashboardMockup() {
  return (
    <div
      role="img"
      aria-label="Aperçu du tableau de bord haxatax"
      style={{
        background: '#fff',
        borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        width: '100%',
        maxWidth: 540,
        flexShrink: 0,
      }}
    >
      {/* Browser chrome */}
      <div style={{
        background: '#1e293b', padding: '10px 14px',
        display: 'flex', gap: 6, alignItems: 'center',
        borderBottom: '1px solid #334155',
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
        <div style={{
          flex: 1, background: '#334155', borderRadius: 6,
          height: 22, margin: '0 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#94a3b8', fontSize: 9 }}>app.haxatax.fr/factures</span>
        </div>
      </div>

      {/* App layout */}
      <div style={{ display: 'flex', minHeight: 320 }}>
        {/* Sidebar */}
        <div style={{
          width: 150, background: '#00382b', padding: '14px 10px',
          display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', marginBottom: 10 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6, background: '#00e676',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#00382b', fontSize: 12, fontWeight: 800,
            }}>H</div>
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>haxatax</span>
          </div>
          {[
            { label: 'Tableau de bord', active: false },
            { label: 'Factures', active: true },
            { label: 'Fournisseurs', active: false },
            { label: 'Banque', active: false },
            { label: 'Export FEC', active: false },
          ].map(({ label, active }) => (
            <div key={label} style={{
              padding: '7px 9px', borderRadius: 6,
              background: active ? 'rgba(0,230,118,0.18)' : 'transparent',
              color: active ? '#00e676' : 'rgba(255,255,255,0.55)',
              fontSize: 10, fontWeight: active ? 600 : 400,
            }}>{label}</div>
          ))}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, background: '#f8fafc', padding: 14, minWidth: 0 }}>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            {[
              { label: 'CA du mois', value: '48 200 €', color: '#00382b' },
              { label: 'Factures', value: '12 en cours', color: '#0f172a' },
              { label: 'TVA collectée', value: '9 640 €', color: '#00382b' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: '#fff', border: '1px solid #e2e8f0',
                borderRadius: 8, padding: '9px 10px',
              }}>
                <div style={{ fontSize: 8, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Invoice list */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dernières factures</div>
            {[
              { ref: 'FAC-2025-042', client: 'Dupont SAS', amount: '2 400 €', status: 'Payée' },
              { ref: 'FAC-2025-041', client: 'Martin SARL', amount: '890 €', status: 'En attente' },
              { ref: 'FAC-2025-040', client: 'Lefebvre & Co', amount: '5 100 €', status: 'Payée' },
            ].map(({ ref, client, amount, status }) => (
              <div key={ref} style={{
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
                padding: '7px 9px', marginBottom: 4,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: '#0f172a' }}>{ref}</div>
                  <div style={{ fontSize: 8, color: '#94a3b8' }}>{client}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#0f172a' }}>{amount}</div>
                  <span style={{
                    fontSize: 7, fontWeight: 600, padding: '2px 5px', borderRadius: 4,
                    background: status === 'Payée' ? '#dcfce7' : '#fef9c3',
                    color: status === 'Payée' ? '#166534' : '#854d0e',
                  }}>{status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Check icon ─────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── LandingPage ────────────────────────────────────────────────────────────

export function LandingPage({ onLoginClick }: LandingPageProps) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#0f172a',
    }}>

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav
        aria-label="Navigation principale"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 clamp(16px, 4vw, 56px)', height: 64,
          borderBottom: '1px solid #e2e8f0', background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(8px)',
          position: 'sticky', top: 0, zIndex: 100,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, background: '#00382b',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 16, fontWeight: 800,
          }} aria-hidden="true">H</div>
          <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>haxatax</span>
        </div>

        {/* Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }} role="list">
          {['Fonctionnalités', 'Tarifs'].map((label) => (
            <a
              key={label}
              href={`#${label.toLowerCase()}`}
              role="listitem"
              style={{ color: '#475569', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none' }}
            >{label}</a>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onLoginClick}
            style={{
              background: 'none', border: '1px solid #e2e8f0', borderRadius: 8,
              padding: '7px 18px', fontWeight: 500, cursor: 'pointer',
              fontSize: '0.875rem', color: '#374151',
            }}
          >Se connecter</button>
          <button
            onClick={onLoginClick}
            style={{
              background: '#00382b', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 20px', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem',
            }}
          >Commencer</button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="hero-heading"
        style={{
          background: 'linear-gradient(150deg, #00382b 0%, #064e3b 50%, #065f46 100%)',
          color: '#fff',
          padding: 'clamp(56px, 8vw, 100px) clamp(16px, 4vw, 56px)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 'clamp(32px, 5vw, 72px)', alignItems: 'center',
        }}>
          {/* Left */}
          <div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,230,118,0.15)', border: '1px solid rgba(0,230,118,0.3)',
              color: '#6ee7b7', borderRadius: 20, padding: '5px 14px',
              fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em',
              textTransform: 'uppercase', marginBottom: 28,
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="#00e676" aria-hidden="true"><circle cx="5" cy="5" r="5" /></svg>
              Conforme DGFiP · Factur-X · FEC
            </span>

            <h1
              id="hero-heading"
              style={{
                margin: '0 0 20px', fontWeight: 800, lineHeight: 1.1,
                fontSize: 'clamp(1.9rem, 4.5vw, 3.2rem)', letterSpacing: '-0.02em',
              }}
            >
              La comptabilité<br />
              française,{' '}
              <em style={{ fontStyle: 'italic', color: '#00e676' }}>simplifiée.</em>
            </h1>

            <p style={{
              margin: '0 0 40px', maxWidth: 480,
              fontSize: 'clamp(0.95rem, 2vw, 1.1rem)',
              color: 'rgba(255,255,255,0.72)', lineHeight: 1.65,
            }}>
              Factures, banque, FEC et TVA — un seul outil open-source conçu pour les PME et les experts-comptables français.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={onLoginClick}
                style={{
                  background: '#00e676', color: '#00382b', border: 'none',
                  borderRadius: 10, padding: '13px 32px',
                  fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(0,230,118,0.4)',
                }}
              >Commencer gratuitement</button>
              <button
                onClick={onLoginClick}
                style={{
                  background: 'rgba(255,255,255,0.08)', color: '#fff',
                  border: '1.5px solid rgba(255,255,255,0.25)', borderRadius: 10,
                  padding: '13px 28px', fontSize: '0.95rem', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >Se connecter →</button>
            </div>
          </div>

          {/* Right — dashboard mockup */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ── Compliance strip ────────────────────────────────────────────── */}
      <section
        aria-label="Certifications et conformité"
        style={{
          borderBottom: '1px solid #e2e8f0',
          padding: 'clamp(20px, 3vw, 32px) clamp(16px, 4vw, 56px)',
          background: '#fafafa',
        }}
      >
        <div style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center',
        }}>
          {[
            'DGFiP FEC certifié',
            'Factur-X / EN 16931',
            'TVA 5,5 % · 10 % · 20 %',
            'RGPD — hébergement UE',
            'Audit SHA-256 inaltérable',
            'Détection fraude IBAN (BEC)',
          ].map((badge) => (
            <span key={badge} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '6px 14px',
              color: '#374151', fontSize: '0.78rem', fontWeight: 500,
            }}>
              <CheckIcon />{badge}
            </span>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section
        id="fonctionnalités"
        aria-labelledby="features-heading"
        style={{ padding: 'clamp(64px, 8vw, 100px) clamp(16px, 4vw, 56px)' }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2
              id="features-heading"
              style={{
                margin: '0 0 14px',
                fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)',
                fontWeight: 700, letterSpacing: '-0.015em',
              }}
            >Tout ce dont votre cabinet a besoin</h2>
            <p style={{ margin: 0, color: '#64748b', maxWidth: 500, lineHeight: 1.6, fontSize: '1rem', marginLeft: 'auto', marginRight: 'auto' }}>
              Conçu pour respecter le Plan Comptable Général et les obligations légales françaises.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 20,
          }}>
            {FEATURES.map((f) => (
              <article
                key={f.title}
                style={{
                  background: '#fff', border: '1px solid #e2e8f0',
                  borderRadius: 14, padding: '24px 22px',
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: '#f0fdf4', border: '1px solid #cce8df',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#00382b', marginBottom: 16,
                }}>
                  {f.icon}
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 700 }}>{f.title}</h3>
                <p style={{ margin: 0, color: '#64748b', lineHeight: 1.65, fontSize: '0.875rem' }}>{f.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section
        id="tarifs"
        aria-labelledby="pricing-heading"
        style={{
          background: '#f8fafc', borderTop: '1px solid #e2e8f0',
          padding: 'clamp(64px, 8vw, 100px) clamp(16px, 4vw, 56px)',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2
              id="pricing-heading"
              style={{
                margin: '0 0 14px',
                fontSize: 'clamp(1.5rem, 3.5vw, 2.25rem)',
                fontWeight: 700, letterSpacing: '-0.015em',
              }}
            >Des tarifs simples et transparents</h2>
            <p style={{ margin: 0, color: '#64748b', maxWidth: 460, lineHeight: 1.6, fontSize: '1rem', marginLeft: 'auto', marginRight: 'auto' }}>
              Commencez gratuitement. Évoluez quand votre activité grandit.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20, alignItems: 'start',
          }}>
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                style={{
                  background: plan.highlight ? '#00382b' : '#fff',
                  border: plan.highlight ? '2px solid #00382b' : '1px solid #e2e8f0',
                  borderRadius: 16,
                  padding: '28px 24px',
                  color: plan.highlight ? '#fff' : '#0f172a',
                  position: 'relative',
                }}
              >
                {plan.highlight && (
                  <span style={{
                    position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                    background: '#00e676', color: '#00382b',
                    fontSize: '0.72rem', fontWeight: 700,
                    padding: '4px 14px', borderRadius: 20,
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}>Populaire</span>
                )}

                <div style={{ marginBottom: 20 }}>
                  <h3 style={{
                    margin: '0 0 6px', fontWeight: 700,
                    color: plan.highlight ? '#a7f3d0' : '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.78rem',
                  }}>{plan.name}</h3>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 'clamp(1.8rem, 3vw, 2.2rem)', fontWeight: 800 }}>{plan.price}</span>
                    <span style={{ fontSize: '0.85rem', opacity: 0.65 }}>{plan.period}</span>
                  </div>
                  <p style={{ margin: '10px 0 0', fontSize: '0.875rem', opacity: 0.75, lineHeight: 1.55 }}>{plan.desc}</p>
                </div>

                <ul role="list" style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {plan.features.map((feat) => (
                    <li key={feat} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: '0.875rem' }}>
                      <span style={{ marginTop: 1, flexShrink: 0 }}>
                        {plan.highlight ? (
                          <svg width="14" height="14" fill="none" stroke="#00e676" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : <CheckIcon />}
                      </span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={onLoginClick}
                  style={{
                    display: 'block', width: '100%',
                    background: plan.highlight ? '#00e676' : 'transparent',
                    color: plan.highlight ? '#00382b' : '#00382b',
                    border: plan.highlight ? 'none' : '1.5px solid #00382b',
                    borderRadius: 10, padding: '11px 0',
                    fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                  }}
                >{plan.cta}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ──────────────────────────────────────────────────── */}
      <section
        aria-labelledby="cta-heading"
        style={{
          background: '#00382b', color: '#fff',
          padding: 'clamp(64px, 8vw, 96px) clamp(16px, 4vw, 56px)',
          textAlign: 'center',
        }}
      >
        <h2
          id="cta-heading"
          style={{ margin: '0 0 16px', fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', fontWeight: 700, letterSpacing: '-0.015em' }}
        >Prêt à gagner du temps sur votre comptabilité ?</h2>
        <p style={{ margin: '0 auto 40px', maxWidth: 480, opacity: 0.75, lineHeight: 1.65, fontSize: '1rem' }}>
          Rejoignez les cabinets et PME qui ont choisi haxatax pour simplifier leur gestion comptable.
        </p>
        <button
          onClick={onLoginClick}
          style={{
            background: '#00e676', color: '#00382b', border: 'none',
            borderRadius: 10, padding: '14px 44px',
            fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 24px rgba(0,230,118,0.3)',
          }}
        >Démarrer maintenant — c'est gratuit</button>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: '1px solid #e2e8f0',
        padding: 'clamp(24px, 3vw, 40px) clamp(16px, 4vw, 56px)',
      }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: '#00382b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 13, fontWeight: 800,
            }} aria-hidden="true">H</div>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>haxatax</span>
          </div>

          <nav aria-label="Liens du pied de page" style={{ display: 'flex', gap: 24 }}>
            {['Fonctionnalités', 'Tarifs', 'Conformité', 'Contact'].map((l) => (
              <a key={l} href={`#${l.toLowerCase()}`} style={{ color: '#64748b', fontSize: '0.82rem', textDecoration: 'none' }}>{l}</a>
            ))}
          </nav>

          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.78rem' }}>
            &copy; 2026 haxatax — Logiciel de comptabilité conforme DGFiP.
          </p>
        </div>
      </footer>

    </div>
  );
}
