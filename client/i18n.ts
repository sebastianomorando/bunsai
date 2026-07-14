import { signal } from "@preact/signals";
import type { Locale } from "./types.ts";

export const DEFAULT_LOCALE: Locale = "en";
const LOCALE_STORAGE_KEY = "bunsai:frontend:locale";

export const localeState = signal<Locale>(DEFAULT_LOCALE);

export const translations = {
  en: {
    "error.operationFailed": "Operation failed",
    "error.http": "HTTP error {status}",
    "error.badRequest": "Bad request",
    "error.notAuthenticated": "Authentication required",
    "error.notAuthorized": "Access denied",
    "error.notFound": "Resource not found",
    "error.conflict": "Conflict",
    "error.validation": "Validation failed",
    "error.rateLimited": "Too many requests",
    "error.internal": "Internal server error",
    "error.genericHttp": "Unexpected error",

    "notice.logoutSuccess": "Logged out",
    "notice.registerSuccess": "Registration completed and login successful",
    "notice.loginSuccess": "Login successful",

    "assets.authRequiredTitle": "Authentication required",
    "assets.authRequiredText": "You must sign in before managing assets.",
    "assets.title": "Asset library",
    "assets.description": "Upload files and generate optimized image variants on demand.",
    "assets.file": "File",
    "assets.assetTitle": "Title (optional)",
    "assets.titlePlaceholder": "A memorable name",
    "assets.upload": "Upload asset",
    "assets.uploading": "Uploading...",
    "assets.uploadSuccess": "Asset uploaded",
    "assets.library": "Files",
    "assets.empty": "No assets yet. Upload the first file above.",
    "assets.copyUrl": "Copy URL",
    "assets.copySuccess": "Asset URL copied",
    "assets.copyError": "The URL could not be copied",
    "assets.delete": "Delete",
    "assets.deleteConfirm": "Delete {filename}? This action cannot be undone.",
    "assets.deleteSuccess": "Asset deleted",

    "brand.title": "Bunsai Users",

    "nav.login": "Login",
    "nav.register": "Register",
    "nav.users": "Users",
    "nav.assets": "Assets",
    "nav.logout": "Logout",

    "language.label": "Language",
    "language.en": "English",
    "language.it": "Italiano",

    "home.title": "User management",
    "home.description": "Small app with registration, login, logout, user list and user details.",
    "home.gotoUsers": "Go to users list",
    "home.createAccount": "Create account",
    "home.signIn": "Sign in",

    "register.title": "Register",
    "register.submitLoading": "Submitting...",
    "register.submit": "Register",

    "login.title": "Login",
    "login.submitLoading": "Submitting...",
    "login.submit": "Login",

    "field.username": "Username",
    "field.email": "Email",
    "field.password": "Password",
    "field.usernameOrEmail": "Username or email",

    "users.authRequiredTitle": "Authentication required",
    "users.authRequiredText": "You must sign in before viewing users.",
    "users.goToLogin": "Go to login",
    "users.title": "Users list",
    "users.sortBy": "Sort by",
    "users.sortBy.date_created": "Created date",
    "users.sortBy.username": "Username",
    "users.sortBy.email": "Email",
    "users.sortBy.role": "Role",
    "users.sortBy.is_active": "Active status",
    "users.direction": "Direction",
    "users.direction.desc": "Descending",
    "users.direction.asc": "Ascending",
    "users.refresh": "Refresh",
    "users.pageSummary": "Page {page} of {totalPages} · Total visible users: {total}",
    "users.empty": "No users available for this account.",
    "users.unnamed": "Unnamed user",
    "users.noEmail": "Email not available",
    "users.detail": "Details",
    "users.prev": "Previous",
    "users.next": "Next",
    "users.perPage": "Per page",

    "detail.title": "User details",
    "detail.loading": "Loading user details...",
    "detail.id": "ID",
    "detail.username": "Username",
    "detail.email": "Email",
    "detail.role": "Role",
    "detail.active": "Active",
    "detail.createdAt": "Created on",
    "detail.activeYes": "Yes",
    "detail.activeNo": "No",
    "detail.backToList": "Back to list",

    "notfound.title": "Page not found",
    "notfound.backHome": "Back to home",

    "role.admin": "Admin",
    "role.user": "User",

    "common.na": "-",
  },
  it: {
    "error.operationFailed": "Operazione fallita",
    "error.http": "Errore HTTP {status}",
    "error.badRequest": "Richiesta non valida",
    "error.notAuthenticated": "Autenticazione richiesta",
    "error.notAuthorized": "Accesso negato",
    "error.notFound": "Risorsa non trovata",
    "error.conflict": "Conflitto",
    "error.validation": "Validazione fallita",
    "error.rateLimited": "Troppe richieste",
    "error.internal": "Errore interno del server",
    "error.genericHttp": "Errore imprevisto",

    "notice.logoutSuccess": "Logout effettuato",
    "notice.registerSuccess": "Registrazione completata e login effettuato",
    "notice.loginSuccess": "Accesso effettuato",

    "assets.authRequiredTitle": "Accesso richiesto",
    "assets.authRequiredText": "Per gestire gli asset devi prima autenticarti.",
    "assets.title": "Libreria asset",
    "assets.description": "Carica file e genera varianti immagine ottimizzate su richiesta.",
    "assets.file": "File",
    "assets.assetTitle": "Titolo (opzionale)",
    "assets.titlePlaceholder": "Un nome facile da ricordare",
    "assets.upload": "Carica asset",
    "assets.uploading": "Caricamento...",
    "assets.uploadSuccess": "Asset caricato",
    "assets.library": "File",
    "assets.empty": "Non ci sono ancora asset. Carica il primo file qui sopra.",
    "assets.copyUrl": "Copia URL",
    "assets.copySuccess": "URL dell’asset copiato",
    "assets.copyError": "Impossibile copiare l’URL",
    "assets.delete": "Elimina",
    "assets.deleteConfirm": "Eliminare {filename}? L’operazione non può essere annullata.",
    "assets.deleteSuccess": "Asset eliminato",

    "brand.title": "Bunsai Users",

    "nav.login": "Login",
    "nav.register": "Registrazione",
    "nav.users": "Utenti",
    "nav.assets": "Asset",
    "nav.logout": "Logout",

    "language.label": "Lingua",
    "language.en": "English",
    "language.it": "Italiano",

    "home.title": "Gestione utenti",
    "home.description": "Mini app con registrazione, login, logout, lista utenti e dettaglio utente.",
    "home.gotoUsers": "Vai alla lista utenti",
    "home.createAccount": "Crea account",
    "home.signIn": "Accedi",

    "register.title": "Registrazione",
    "register.submitLoading": "Invio...",
    "register.submit": "Registrati",

    "login.title": "Login",
    "login.submitLoading": "Invio...",
    "login.submit": "Accedi",

    "field.username": "Username",
    "field.email": "Email",
    "field.password": "Password",
    "field.usernameOrEmail": "Username o email",

    "users.authRequiredTitle": "Accesso richiesto",
    "users.authRequiredText": "Per vedere gli utenti devi prima autenticarti.",
    "users.goToLogin": "Vai al login",
    "users.title": "Lista utenti",
    "users.sortBy": "Ordina per",
    "users.sortBy.date_created": "Data creazione",
    "users.sortBy.username": "Username",
    "users.sortBy.email": "Email",
    "users.sortBy.role": "Ruolo",
    "users.sortBy.is_active": "Stato attivo",
    "users.direction": "Direzione",
    "users.direction.desc": "Discendente",
    "users.direction.asc": "Ascendente",
    "users.refresh": "Aggiorna",
    "users.pageSummary": "Pagina {page} di {totalPages} · Totale utenti visibili: {total}",
    "users.empty": "Nessun utente disponibile per questo account.",
    "users.unnamed": "Utente senza nome",
    "users.noEmail": "Email non disponibile",
    "users.detail": "Dettaglio",
    "users.prev": "Precedente",
    "users.next": "Successiva",
    "users.perPage": "Per pagina",

    "detail.title": "Dettaglio utente",
    "detail.loading": "Caricamento dettaglio...",
    "detail.id": "ID",
    "detail.username": "Username",
    "detail.email": "Email",
    "detail.role": "Ruolo",
    "detail.active": "Attivo",
    "detail.createdAt": "Creato il",
    "detail.activeYes": "Sì",
    "detail.activeNo": "No",
    "detail.backToList": "Torna alla lista",

    "notfound.title": "Pagina non trovata",
    "notfound.backHome": "Torna alla home",

    "role.admin": "Admin",
    "role.user": "Utente",

    "common.na": "-",
  },
} as const;

export type TranslationKey = keyof (typeof translations)["en"];

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {}
): string {
  const template = translations[locale][key] ?? translations[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = params[name];
    return value === undefined ? "" : String(value);
  });
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(localeState.value, key, params);
}

function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "it";
}

export function readStoredLocale(): Locale {
  if (typeof localStorage === "undefined") {
    return DEFAULT_LOCALE;
  }

  const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export function setLocale(nextLocale: Locale) {
  localeState.value = nextLocale;

  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
}

export function formatRole(role: string | null) {
  if (role === "admin") {
    return t("role.admin");
  }
  if (role === "user") {
    return t("role.user");
  }
  return role ?? t("common.na");
}
