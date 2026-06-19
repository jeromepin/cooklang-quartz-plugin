import enUS from "./locales/en-US"
import fr from "./locales/fr"

type Locale = typeof enUS

const locales: Record<string, Locale> = {
  "en-US": enUS,
  en: enUS,
  "fr-FR": fr,
  fr: fr,
}

export function i18n(locale?: string): Locale {
  if (!locale) return enUS
  return locales[locale] ?? locales[locale.split("-")[0]] ?? enUS
}

export type { Locale }
