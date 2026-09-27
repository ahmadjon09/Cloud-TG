import test from 'node:test';
import assert from 'node:assert/strict';
import { api, mediaLink, clearMediaLinks, downloadMedia } from '../public/js/api.js';

test('web media links share one token request and native downloads use absolute URLs', async t => {
  const previous = globalThis.window;
  const downloads = [];
  globalThis.window = { location: { href: 'https://cloud.example/app' }, Telegram: { WebApp: {
    initData: 'test-session', isVersionAtLeast: () => true, downloadFile: data => downloads.push(data)
  } } };
  t.after(() => { globalThis.window = previous; clearMediaLinks(); });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    requests++;
    assert.equal(opts.headers['x-telegram-init-data'], 'test-session');
    assert.equal(opts.headers['x-cloud-session'], '1');
    return Response.json({ preview: '/preview', thumb: '/thumb', download: '/download', expiresIn: 3600 });
  });
  clearMediaLinks();
  const file = { id: 'file', fileName: 'hello.txt' };
  assert.deepEqual(await Promise.all([mediaLink(file), mediaLink(file, 'thumb'), mediaLink(file, 'download')]), ['/preview', '/thumb', '/download']);
  assert.equal(requests, 1);
  await downloadMedia(file);
  assert.deepEqual(downloads, [{ url: 'https://cloud.example/download', file_name: 'hello.txt' }]);
  assert.equal(requests, 1);
});

test('ordinary browser downloads use a temporary anchor', async t => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const events = [];
  const anchor = { click: () => events.push('click'), remove: () => events.push('remove') };
  globalThis.window = { Telegram: { WebApp: { initData: 'session' } } };
  globalThis.document = { createElement: () => anchor, body: { append: () => events.push('append') } };
  t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; clearMediaLinks(); });
  clearMediaLinks();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ download: '/download', expiresIn: 3600 }));
  await downloadMedia({ id: 'browser-file', fileName: 'test.txt' });
  assert.equal(anchor.href, '/download');
  assert.equal(anchor.download, 'test.txt');
  assert.deepEqual(events, ['append', 'click', 'remove']);
});

test('web API never resurrects an expired initData value from local storage', async t => {
  const previousWindow = globalThis.window;
  const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const previousStorage = globalThis.localStorage;
  globalThis.window = { Telegram: { WebApp: { initData: '' } } };
  globalThis.localStorage = {
    getItem() {
      throw new Error('initData must not be read from localStorage');
    }
  };
  t.after(() => {
    globalThis.window = previousWindow;
    if (hadStorage) globalThis.localStorage = previousStorage;
    else delete globalThis.localStorage;
  });
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    assert.equal(opts.headers['x-telegram-init-data'], undefined);
    assert.equal(opts.headers['x-cloud-session'], '1');
    return Response.json({ ok: true });
  });

  assert.deepEqual(await api.me(), { ok: true });
});
