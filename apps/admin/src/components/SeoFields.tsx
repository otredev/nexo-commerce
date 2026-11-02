import { clip, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "@nexo/shared";
import { TextAreaField, TextField } from "@nexo/ui";

/** Title + description with counters, and how the result looks in Google. Empty → the defaults shown in grey. */
export function SeoFields({
  title, description, onTitle, onDescription, fallbackTitle, fallbackDescription, url, disabled, errors = {},
}: {
  title: string;
  description: string;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  fallbackTitle: string;
  fallbackDescription: string;
  url: string;
  disabled?: boolean;
  errors?: { title?: string; description?: string };
}) {
  const shownTitle = clip(title || fallbackTitle, SEO_TITLE_MAX);
  const shownDescription = clip(description || fallbackDescription, SEO_DESCRIPTION_MAX);
  const count = (v: string, max: number) => <span className="nx-num" style={{ color: v.length > max ? "var(--danger)" : undefined }}>{v.length}/{max}</span>;
  return (
    <div className="nx-stack">
      <TextField
        label="Título para buscadores"
        optional
        value={title}
        maxLength={SEO_TITLE_MAX}
        onChange={(e) => onTitle(e.target.value)}
        placeholder={fallbackTitle}
        disabled={disabled}
        error={errors.title}
        help={<>Lo que aparece como enlace en Google. {count(title, SEO_TITLE_MAX)}</>}
      />
      <TextAreaField
        label="Descripción para buscadores"
        optional
        rows={2}
        value={description}
        maxLength={SEO_DESCRIPTION_MAX}
        onChange={(e) => onDescription(e.target.value)}
        placeholder={fallbackDescription}
        disabled={disabled}
        error={errors.description}
        help={<>Una o dos frases que inviten a entrar. {count(description, SEO_DESCRIPTION_MAX)}</>}
      />
      <div className="nx-serp" aria-label="Vista previa en Google">
        <div className="nx-serp__url">{url}</div>
        <div className="nx-serp__title">{shownTitle}</div>
        <div className="nx-serp__desc">{shownDescription}</div>
      </div>
    </div>
  );
}
