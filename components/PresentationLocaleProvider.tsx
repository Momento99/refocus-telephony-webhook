'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  getPresentationPrivacyKind,
  isPresentationRoute,
  privatizePresentationText,
  PRESENTATION_LOCALE_COOKIE,
  translatePresentationText,
  type PresentationLocale,
  type PresentationPrivacyKind,
} from '@/lib/presentationTranslations';

const SKIP_SELECTOR = 'script,style,noscript,textarea,code,pre,[contenteditable="true"],[data-i18n-ignore]';
const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'placeholder', 'title'] as const;
const PRIVACY_OVERLAY_ATTRIBUTE = 'data-presentation-privacy-overlay';
const PRIVATE_INPUT_ATTRIBUTE = 'data-presentation-private-input';

function readStoredLocale(): PresentationLocale {
  const queryLocale = new URLSearchParams(window.location.search).get('lang');
  if (queryLocale === 'ru' || queryLocale === 'en') return queryLocale;

  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${PRESENTATION_LOCALE_COOKIE}=`))
    ?.split('=')[1];
  if (cookie === 'en') return 'en';

  return window.localStorage.getItem(PRESENTATION_LOCALE_COOKIE) === 'en' ? 'en' : 'ru';
}

function shouldSkip(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return Boolean(element?.closest(SKIP_SELECTOR));
}

function translateTree(root: Node): void {
  if (shouldSkip(root)) return;

  if (root.nodeType === Node.TEXT_NODE) {
    const current = root.nodeValue;
    if (current) {
      const translated = translatePresentationText(current);
      if (translated !== current) root.nodeValue = translated;
    }
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  if (root.nodeType === Node.ELEMENT_NODE) {
    const element = root as Element;
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const translated = translatePresentationText(current);
      if (translated !== current) element.setAttribute(attribute, translated);
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (!shouldSkip(current)) {
      if (current.nodeType === Node.TEXT_NODE) {
        const value = current.nodeValue;
        if (value) {
          const translated = translatePresentationText(value);
          if (translated !== value) current.nodeValue = translated;
        }
      } else if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as Element;
        for (const attribute of TRANSLATABLE_ATTRIBUTES) {
          const value = element.getAttribute(attribute);
          if (!value) continue;
          const translated = translatePresentationText(value);
          if (translated !== value) element.setAttribute(attribute, translated);
        }
      }
    }
    current = walker.nextNode();
  }
}

function tableFieldKind(element: Element): PresentationPrivacyKind | null {
  const cell = element.closest('td');
  const row = cell?.parentElement;
  const table = cell?.closest('table');
  if (!cell || !row || !table) return null;

  const cellIndex = Array.from(row.children).indexOf(cell);
  if (cellIndex < 0) return null;
  const headerRows = table.querySelectorAll('thead tr');
  const headerRow = headerRows.item(headerRows.length - 1);
  const header = headerRow?.children.item(cellIndex);
  return getPresentationPrivacyKind(header?.textContent ?? '');
}

function nearbyLabelKind(element: Element): PresentationPrivacyKind | null {
  // Buttons and links often sit beside navigation labels (for example the
  // Orders toolbar's Customers / Refresh controls).  They are actions, not
  // label-value pairs, so treating a neighbouring label as their data type can
  // replace an action caption with a privacy alias.
  if (element.closest('button, a, thead, th')) return null;

  const parent = element.parentElement;
  if (!parent) return null;
  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(element);

  // Buyer-facing cards use a compact label immediately before the value.
  for (let i = index - 1; i >= Math.max(0, index - 2); i -= 1) {
    const kind = getPresentationPrivacyKind(siblings[i]?.textContent ?? '');
    if (kind) return kind;
  }
  return null;
}

function routeSpecificPrivacyKind(
  element: Element,
  pathname: string,
): PresentationPrivacyKind | null {
  if (pathname === '/orders') {
    const parentButton = element.parentElement;
    if (
      parentButton?.tagName === 'BUTTON'
      && parentButton.classList.contains('text-left')
      && element.classList.contains('font-semibold')
      && Boolean(element.closest('tbody td'))
    ) {
      return 'customer';
    }
  }

  if (pathname === '/settings/payroll') {
    const parent = element.parentElement;
    const employeeSummaryButton = parent?.parentElement;
    if (
      parent?.classList.contains('flex-1')
      && employeeSummaryButton?.tagName === 'BUTTON'
      && element.classList.contains('font-semibold')
    ) {
      return 'employee';
    }

    if (
      element.tagName === 'SPAN'
      && element.classList.contains('font-semibold')
      && /(?:Shift access|Доступ в смену)/.test(element.closest('details')?.textContent ?? '')
    ) {
      return 'employee';
    }
  }

  return null;
}

function privacyKindForElement(
  element: Element,
  pathname: string,
): PresentationPrivacyKind | null {
  const tableKind = tableFieldKind(element);
  // The returns dashboard contains aggregate prescription counts/costs, not a
  // customer's prescription.  Keep those business metrics visible.
  const safeTableKind = pathname === '/admin/returns' && tableKind === 'private'
    ? null
    : tableKind;
  return safeTableKind
    ?? nearbyLabelKind(element)
    ?? routeSpecificPrivacyKind(element, pathname);
}

function privacyAliasForInput(
  input: HTMLInputElement,
  kind: PresentationPrivacyKind,
): string {
  return privatizePresentationText(input.value, kind);
}

function protectPrivateInput(
  input: HTMLInputElement,
  pathname: string,
): void {
  if (input.type === 'hidden') return;

  let kind: PresentationPrivacyKind | null = null;
  if (input.type === 'tel') kind = 'phone';
  else if (input.type === 'email') kind = 'email';
  else if (input.type === 'password') kind = 'private';
  else {
    kind = privacyKindForElement(input, pathname)
      ?? getPresentationPrivacyKind(input.getAttribute('aria-label') ?? '')
      ?? getPresentationPrivacyKind(input.getAttribute('placeholder') ?? '');
  }

  // The payroll employee table intentionally has no visible column headers.
  if (!kind && pathname === '/settings/payroll') {
    const cell = input.closest('td');
    const table = cell?.closest('table');
    if (cell?.cellIndex === 0 && table && !table.querySelector('thead')) kind = 'employee';
  }

  if (!kind || !input.value) return;
  const alias = privacyAliasForInput(input, kind);
  if (alias === input.value && kind !== 'private') return;

  const parent = input.parentElement;
  if (!parent) return;
  let overlay = parent.querySelector<HTMLElement>(`:scope > [${PRIVACY_OVERLAY_ATTRIBUTE}]`);
  if (!overlay) {
    overlay = document.createElement('span');
    overlay.setAttribute(PRIVACY_OVERLAY_ATTRIBUTE, '');
    overlay.setAttribute('data-i18n-ignore', '');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:1',
      'display:flex',
      'align-items:center',
      'padding:0 0.75rem',
      'pointer-events:none',
      'overflow:hidden',
      'white-space:nowrap',
      'text-overflow:ellipsis',
      'color:#0f172a',
      'font:inherit',
    ].join(';');
    if (window.getComputedStyle(parent).position === 'static') {
      parent.dataset.presentationPrivacyPosition = parent.style.position;
      parent.style.position = 'relative';
    }
    parent.appendChild(overlay);
  }
  overlay.textContent = alias;

  if (!input.hasAttribute(PRIVATE_INPUT_ATTRIBUTE)) {
    input.dataset.presentationPrivacyColor = input.style.color;
    input.dataset.presentationPrivacyCaretColor = input.style.caretColor;
    input.setAttribute(PRIVATE_INPUT_ATTRIBUTE, '');
  }
  input.style.setProperty('color', 'transparent', 'important');
  input.style.setProperty('caret-color', 'transparent', 'important');
}

function privacyTextNode(node: Node, pathname: string): void {
  const current = node.nodeValue;
  const element = node.parentElement;
  if (!current || !element) return;
  const transformed = privatizePresentationText(
    current,
    privacyKindForElement(element, pathname),
  );
  if (transformed !== current) node.nodeValue = transformed;
}

function privacyElement(element: Element, pathname: string): void {
  const kind = privacyKindForElement(element, pathname);
  for (const attribute of ['aria-label', 'title'] as const) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const transformed = privatizePresentationText(value, kind);
    if (transformed !== value) element.setAttribute(attribute, transformed);
  }
  if (element instanceof HTMLInputElement) protectPrivateInput(element, pathname);
}

function privatizeTree(root: Node, pathname: string): void {
  if (shouldSkip(root)) return;
  if (root.nodeType === Node.TEXT_NODE) {
    privacyTextNode(root, pathname);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  if (root.nodeType === Node.ELEMENT_NODE) privacyElement(root as Element, pathname);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (!shouldSkip(current)) {
      if (current.nodeType === Node.TEXT_NODE) privacyTextNode(current, pathname);
      else if (current.nodeType === Node.ELEMENT_NODE) privacyElement(current as Element, pathname);
    }
    current = walker.nextNode();
  }
}

function clearPrivateInputPresentation(): void {
  document.querySelectorAll(`[${PRIVACY_OVERLAY_ATTRIBUTE}]`).forEach((overlay) => overlay.remove());
  document.querySelectorAll<HTMLInputElement>(`input[${PRIVATE_INPUT_ATTRIBUTE}]`).forEach((input) => {
    input.style.color = input.dataset.presentationPrivacyColor ?? '';
    input.style.caretColor = input.dataset.presentationPrivacyCaretColor ?? '';
    delete input.dataset.presentationPrivacyColor;
    delete input.dataset.presentationPrivacyCaretColor;
    input.removeAttribute(PRIVATE_INPUT_ATTRIBUTE);
  });
  document.querySelectorAll<HTMLElement>('[data-presentation-privacy-position]').forEach((element) => {
    element.style.position = element.dataset.presentationPrivacyPosition ?? '';
    delete element.dataset.presentationPrivacyPosition;
  });
}

function persistLocale(locale: PresentationLocale): void {
  document.cookie = `${PRESENTATION_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.localStorage.setItem(PRESENTATION_LOCALE_COOKIE, locale);
}

export default function PresentationLocaleProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const supported = isPresentationRoute(pathname);
  const [locale, setLocale] = useState<PresentationLocale>('ru');
  const [hideSwitcher, setHideSwitcher] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('lang');
    const initialLocale: PresentationLocale = requested === 'en' || requested === 'ru'
      ? requested
      : readStoredLocale();
    persistLocale(initialLocale);
    setLocale(initialLocale);
    setHideSwitcher(params.get('presentation') === '1');
    setPrivacyMode(params.get('privacy') === '1');
  }, []);

  useEffect(() => {
    document.documentElement.lang = supported ? locale : 'ru';
    document.documentElement.dataset.presentationLocale = supported ? locale : 'ru';
    document.documentElement.dataset.presentationPrivacy = supported && privacyMode ? 'masked' : 'off';
    if (!supported || (locale !== 'en' && !privacyMode)) return;

    const transform = (root: Node) => {
      if (locale === 'en') translateTree(root);
      if (privacyMode) privatizeTree(root, pathname);
    };

    let frame = window.requestAnimationFrame(() => transform(document.body));
    const observer = new MutationObserver((mutations) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') transform(mutation.target);
          for (const node of mutation.addedNodes) transform(node);
          if (mutation.type === 'attributes') transform(mutation.target);
        }
      });
    });

    const refreshPrivateInput = (event: Event) => {
      if (privacyMode && event.target instanceof HTMLInputElement) {
        protectPrivateInput(event.target, pathname);
      }
    };
    if (privacyMode) document.addEventListener('input', refreshPrivateInput, true);

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('input', refreshPrivateInput, true);
      clearPrivateInputPresentation();
    };
  }, [locale, pathname, privacyMode, supported]);

  const changeLocale = (next: PresentationLocale) => {
    if (next === locale) return;
    persistLocale(next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.location.assign(url.toString());
  };

  return (
    <>
      {children}
      {supported && !hideSwitcher ? (
        <div
          data-i18n-ignore
          data-presentation-locale-switch
          className="fixed bottom-4 right-4 z-[100] flex items-center gap-1 rounded-full border border-cyan-400/20 bg-slate-950/90 p-1 text-[11px] font-bold shadow-2xl backdrop-blur"
          aria-label="Interface language"
        >
          {(['ru', 'en'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => changeLocale(item)}
              aria-pressed={locale === item}
              className={`rounded-full px-3 py-1.5 transition ${
                locale === item
                  ? 'bg-cyan-400 text-slate-950'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
