import type { ReactNode } from "react";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="nx-auth">
      <div className="nx-auth__box">
        <div className="nx-auth__brand">
          <span className="nx-brand-dot" aria-hidden="true" />
          Nexo
        </div>
        <div className="nx-card">
          <div className="nx-card__header" style={{ flexDirection: "column", gap: 2 }}>
            <h1 className="nx-modal__title">{title}</h1>
            {subtitle && <p className="nx-card__desc">{subtitle}</p>}
          </div>
          <div className="nx-card__body">{children}</div>
        </div>
        {footer && <div className="nx-auth__footer">{footer}</div>}
      </div>
    </div>
  );
}
