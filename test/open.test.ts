import { describe, expect, it } from 'vitest';

import { browserCommand } from '../server/open.js';

/** --open (2.4.8): which program opens the board's address. */
describe('--open', () => {
  const url = 'http://127.0.0.1:4310/';
  it('uses $BROWSER when set, else the system opener', () => {
    expect(browserCommand(url, { BROWSER: 'firefox' }, 'linux')).toEqual(['firefox', [url]]);
    expect(browserCommand(url, {}, 'darwin')).toEqual(['open', [url]]);
    expect(browserCommand(url, {}, 'linux')).toEqual(['xdg-open', [url]]);
    expect(browserCommand(url, {}, 'win32')).toEqual(['cmd', ['/c', 'start', '""', url]]);
  });
});
