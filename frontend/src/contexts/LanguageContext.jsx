import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { translate, LANGUAGES } from "../lib/i18n";
import { supabase } from "../lib/supabaseClient";

const LanguageContext = createContext(null);
const STORAGE_KEY = "orion_lang";

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem(STORAGE_KEY) || "en");

  const setLang = useCallback(async (code, userId) => {
    setLangState(code);
    localStorage.setItem(STORAGE_KEY, code);
    if (userId) {
      try {
        await supabase.from("profiles").update({ preferred_language: code }).eq("id", userId);
      } catch {
        // best-effort — UI already reflects the change locally
      }
    }
  }, []);

  const syncLanguageFromProfile = useCallback((preferredLang) => {
    if (preferredLang && ["en", "hi", "ta"].includes(preferredLang)) {
      setLangState(preferredLang);
      localStorage.setItem(STORAGE_KEY, preferredLang);
    }
  }, []);

  const t = useCallback((key) => translate(lang, key), [lang]);

  const value = useMemo(
    () => ({ lang, setLang, syncLanguageFromProfile, t, languages: LANGUAGES }),
    [lang, setLang, syncLanguageFromProfile, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
