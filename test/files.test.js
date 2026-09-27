import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { connectDB } from '../src/db.js';
import { createMongoStore } from '../src/store/mongo.js';
import { FileModel } from '../src/models/File.js';
import { apiRouter } from '../src/http/routes/api.js';
import { mediaRouter } from '../src/http/routes/media.js';
import { webAppAuthMiddleware } from '../src/authWebApp.js';
import { errorHandler } from '../src/http/middleware.js';
import { caches, invalidateAll, invalidateUser } from '../src/utils/cache.js';
import { signMediaToken } from '../src/http/mediaToken.js';

function session(id) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Test' }) });
  const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(data).digest('hex'));
  return params.toString();
}

test('Mongo transfer lookup retains file_id without leaking it in public data', async t => {
  const id = '0123456789abcdef01234567';
  const doc = { _id: id, ownerTgUserId: '42', tgFileId: 'telegram-file', fileName: 'test.jpg' };
  t.mock.method(FileModel, 'findOne', filter => ({ lean: async () => filter.ownerTgUserId === '42' ? doc : null }));
  const store = createMongoStore();
  assert.equal((await store.getFileForTransfer(id, '42')).tgFileId, 'telegram-file');
  assert.equal((await store.getFileOwned(id, '42')).tgFileId, undefined);
  assert.equal(await store.getFileForTransfer(id, '99'), null);
  assert.equal(await store.getFileForTransfer('invalid', '42'), null);
});

test('file API and media regression coverage', async t => {
  const oldToken = process.env.BOT_TOKEN;
  process.env.BOT_TOKEN = 'test-token';
  t.after(() => {
    if (oldToken === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = oldToken;
  });
  const { store } = await connectDB('', { forceMemory: true });
  invalidateAll();
  await store.ensureUser({ id: '42' });
  const file = await store.createFile({ ownerId: '42', tgFileId: 'stored-file-id', fileName: 'salom.txt', fileSize: 5 });
  const image = await store.createFile({ ownerId: '42', tgFileId: 'image-id', fileName: 'photo.jpg', kind: 'photo', fileSize: 5 });
  const large = await store.createFile({ ownerId: '42', tgFileId: 'large-id', fileName: 'big.zip', fileSize: 21 * 1024 * 1024 });
  const app = express();
  app.use(express.json());
  app.use('/api', mediaRouter());
  app.use('/api', webAppAuthMiddleware, apiRouter());
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    if (!String(url).startsWith('https://api.telegram.org/')) return realFetch(url, opts);
    if (String(url).includes('/file/bot')) {
      const range = opts.headers?.Range;
      return new Response(range ? 'he' : 'hello', { status: range ? 206 : 200, headers: {
        'content-type': 'text/plain', 'content-length': range ? '2' : '5',
        ...(range ? { 'content-range': 'bytes 0-1/5', 'accept-ranges': 'bytes' } : {})
      } });
    }
    const payload = JSON.parse(opts.body);
    calls.push({ url: String(url), payload });
    if (String(url).endsWith('/getFile')) {
      assert.ok(payload.file_id, 'Telegram getFile must receive a stored file_id');
      return Response.json({ ok: true, result: { file_path: 'documents/test.txt' } });
    }
    assert.ok(payload.document || payload.photo, 'send must receive a stored file_id');
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  const request = (path, opts = {}, owner = 42) => fetch(base + path, { ...opts, headers: { 'x-telegram-init-data': session(owner), 'content-type': 'application/json', ...opts.headers } });
  let links;
  await t.test('lists saved files and excludes other owners; no private Telegram IDs', async () => {
    const result = await (await request('/api/files')).json();
    assert.equal(result.total, 3);
    assert.equal(result.items[0].tgFileId, undefined);
    assert.equal((await (await request('/api/files', {}, 99)).json()).total, 0);
    assert.equal((await request(`/api/files/${file.id}/token`, { method: 'POST' }, 99)).status, 404);
    assert.equal((await realFetch(base + '/api/files')).status, 401);
    assert.equal((await (await request('/api/files?category=images')).json()).total, 1);
  });
  await t.test('issues links, previews text, downloads bytes and handles HEAD/Range', async () => {
    links = await (await request(`/api/files/${file.id}/token`, { method: 'POST' })).json();
    for (const kind of ['preview', 'download']) {
      const response = await request(links[kind]);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'hello');
      if (kind === 'download') assert.match(response.headers.get('content-disposition'), /attachment.*salom.txt/);
    }
    const range = await request(links.preview, { headers: { range: 'bytes=0-1' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 0-1/5');
    assert.equal(await range.text(), 'he');
    const head = await request(links.download, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(calls.find(c => c.url.endsWith('/getFile')).payload.file_id, 'stored-file-id');
  });
  await t.test('rejects missing, mismatched, expired and wrong-purpose tokens', async () => {
    assert.equal((await request(`/api/media/${file.id}/download`)).status, 401);
    assert.equal((await request(links.preview.replace('/preview?', '/download?'))).status, 401);
    assert.equal((await request(links.download.replace(file.id, image.id))).status, 401);
    const token = signMediaToken({ fileId: file.id, userId: '42', purpose: 'download', ttl: -1 });
    assert.equal((await request(`/api/media/${file.id}/download?token=${token}`)).status, 401);
  });
  await t.test('single and bulk Telegram sends use internal file IDs', async () => {
    assert.equal((await request(`/api/files/${file.id}/send`, { method: 'POST' })).status, 200);
    const result = await (await request('/api/files/bulk', { method: 'POST', body: JSON.stringify({ ids: [file.id, image.id], action: 'send' }) })).json();
    assert.equal(result.done, 2);
    assert.equal(result.failed, 0);
  });
  await t.test('large files are rejected before getFile; trash cannot be downloaded', async () => {
    const link = await (await request(`/api/files/${large.id}/token`, { method: 'POST' })).json();
    assert.equal((await request(link.download)).status, 413);
    assert.equal(calls.some(c => c.payload.file_id === 'large-id'), false);
    await request(`/api/files/${file.id}`, { method: 'DELETE' });
    assert.equal((await request(links.download)).status, 410);
    assert.equal((await (await request('/api/files?trash=true')).json()).total, 1);
  });
  await t.test('mutations invalidate cached category counts', () => {
    caches.stats.set('counts:42', { all: 99 });
    invalidateUser('42');
    assert.equal(caches.stats.get('counts:42'), undefined);
  });
});
