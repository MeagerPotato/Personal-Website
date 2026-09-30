/**
 * Math in the studio, typeset by the same Temml as the published page. Temml writes a few style
 * attributes, and the studio's policy allows none in markup, not even in a document DOMParser
 * makes (it inherits the page's policy, and reports each one). So they are renamed before the
 * markup is parsed, and their declarations set again one by one through CSSOM, which the policy
 * allows.
 */
import temml from 'temml';

export type Typeset = { html: string; error: null } | { html: null; error: string };

/** LaTeX to MathML, or what is wrong with it. Pure: no DOM. */
export function typeset(latex: string, display: boolean): Typeset {
  const source = latex.trim();
  if (!source) return { html: '', error: null };
  try {
    const html = temml.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      annotate: true,
      trust: false,
    });
    return { html, error: null };
  } catch (error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : '';
    return {
      html: null,
      error: message.replace(/^Temml parse error:\s*/, '') || 'This LaTeX can’t be typeset',
    };
  }
}

/** Where Temml's style attributes wait while its markup is parsed. */
const STYLE = 'data-temml-style';

/** `color:red;width:1em` onto an element's style, through CSSOM. */
function applyDeclarations(style: CSSStyleDeclaration, declarations: string): void {
  for (const declaration of declarations.split(';')) {
    const at = declaration.indexOf(':');
    if (at < 0) continue;
    const name = declaration.slice(0, at).trim();
    const value = declaration.slice(at + 1).trim();
    const important = /!important$/.test(value);
    style.setProperty(name, value.replace(/\s*!important$/, ''), important ? 'important' : '');
  }
}

/** Puts typeset math into `target`; LaTeX that could not be typeset shows as itself. */
export function drawMath(target: Element, result: Typeset, latex: string): void {
  if (result.html === null) {
    const code = document.createElement('code');
    code.className = 'math-error';
    code.textContent = latex.trim();
    target.replaceChildren(code);
    return;
  }
  // Temml escapes every text and attribute value it takes from the LaTeX, so ` style="` in its
  // output only ever starts one of its own style attributes.
  const markup = result.html.replaceAll(' style="', ` ${STYLE}="`);
  const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
  const imported = [...parsed.body.children].map((child) => document.importNode(child, true));
  for (const root of imported) {
    for (const element of [root, ...root.querySelectorAll(`[${STYLE}]`)]) {
      const declarations = element.getAttribute(STYLE);
      if (declarations === null) continue;
      element.removeAttribute(STYLE);
      if (element instanceof HTMLElement || element instanceof MathMLElement) {
        applyDeclarations(element.style, declarations);
      }
    }
  }
  target.replaceChildren(...imported);
}
