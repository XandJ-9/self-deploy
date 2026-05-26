import type { ReactNode } from 'react';

interface PageHeroProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHero({ title, description, actions }: PageHeroProps) {
  return (
    <header className="page-hero">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions && <div className="hero-actions">{actions}</div>}
    </header>
  );
}
