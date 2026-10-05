import { useLanguage } from "../../contexts/LanguageContext";
import { useAuth } from "../../contexts/AuthContext";

export default function LanguageSwitcher() {
  const { lang, setLang, languages } = useLanguage();
  const { user } = useAuth();

  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value, user?.id)}
      className="bg-base-raised border border-base-border rounded-md text-xs font-mono px-2 py-1 text-ink-muted focus:outline-none focus:border-signal/50"
      title="Language"
    >
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.nativeLabel}
        </option>
      ))}
    </select>
  );
}
