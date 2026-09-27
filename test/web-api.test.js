import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaLink, clearMediaLinks, downloadMedia } from '../public/js/api.js';

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
