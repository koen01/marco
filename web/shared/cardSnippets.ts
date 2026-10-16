// Starter cards of the custom HTML editor (and the demo screen): a big temperature, a list of rooms and a quote. Each
// passes the allowlist of cardTemplate.ts and uses only the theme variables, so it looks right on any card.
export interface CardSnippet {
  id: 'temp' | 'rooms' | 'quote';
  html: string;
  css: string;
  bind: { name: string; entity?: string; builtin?: 'time' | 'date' | 'weather' | 'nextEvent' }[];
}

/** The starter cards; `quote` is the sample text of the quote card (in the admin's language). */
export function cardSnippets(quote: string): CardSnippet[] {
  return [
    {
      id: 'temp',
      html: '<div class="big">\n  <div class="v">{{temp | round:1}}<small>{{temp.unit}}</small></div>\n  <div class="n">{{temp.name}} · {{temp.ago}}</div>\n</div>',
      css: '.big { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 0.3em; }\n.v { font-size: 4em; font-weight: 700; line-height: 1; }\n.v small { font-size: 0.4em; font-weight: 500; margin-left: 0.15em; color: var(--ink-2); }\n.n { color: var(--ink-2); }',
      bind: [{ name: 'temp', entity: '' }],
    },
    {
      id: 'rooms',
      html:
        '<ul class="rooms">\n  <li><span>{{room1.name}}</span><b>{{room1 | round:1}} {{room1.unit}}</b></li>\n  <li><span>{{room2.name}}</span><b>{{room2 | round:1}} {{room2.unit}}</b></li>\n' +
        '  <li class="door-{{door.on}}"><span>{{door.name}}</span><b>{{door}}</b></li>\n</ul>',
      css: '.rooms { list-style: none; margin: 0; padding: 0; height: 100%; display: flex; flex-direction: column; justify-content: center; }\nli { display: flex; justify-content: space-between; gap: 1em; padding: 0.45em 0; border-bottom: 1px solid var(--sep); }\nli:last-child { border-bottom: 0; }\nspan { color: var(--ink-2); }\n.door-on b { color: var(--accent); }',
      bind: [{ name: 'room1', entity: '' }, { name: 'room2', entity: '' }, { name: 'door', entity: '' }],
    },
    {
      id: 'quote',
      html: `<div class="q">\n  <p>${quote.replace(/[&<>"'`{}]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>\n  <small>{{today}}</small>\n</div>`,
      css: '.q { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 0.6em; }\np { margin: 0; font-size: 1.6em; font-weight: 600; line-height: 1.2; }\np::before { content: "“"; color: var(--accent); }\np::after { content: "”"; color: var(--accent); }\nsmall { font-size: 1em; color: var(--ink-2); }',
      bind: [{ name: 'today', builtin: 'date' }],
    },
  ];
}
