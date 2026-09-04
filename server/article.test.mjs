import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchArticleExcerpt, findMatchingArticleUrl, isPublicIp, readableExcerpt } from './article.mjs'

test('article extraction refuses loopback and local targets', async () => {
  assert.equal(await fetchArticleExcerpt('http://127.0.0.1:8787/private'), '')
  assert.equal(await fetchArticleExcerpt('http://localhost/private'), '')
  assert.equal(await fetchArticleExcerpt('file:///etc/passwd'), '')
  assert.equal(await findMatchingArticleUrl('http://127.0.0.1:8787', 'Private headline'), '')
})

test('article network policy permits only globally routable addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPublicIp(address), false, address)
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicIp(address), true, address)
})

test('article extraction rejects a publisher homepage that does not match the expected story', () => {
  const paragraphs = `<p>${'Generic publisher homepage copy about science and research. '.repeat(8)}</p><p>${'More unrelated homepage material for readers. '.repeat(8)}</p>`
  assert.equal(readableExcerpt(`<html><head><title>Nature — science news</title></head><body><main>${paragraphs}</main></body></html>`, 'Explainable AI: learning from the learners - Nature'), '')
  assert.match(readableExcerpt(`<html><head><title>Explainable AI: learning from the learners</title></head><body><article>${paragraphs}</article></body></html>`, 'Explainable AI: learning from the learners - Nature'), /Generic publisher/)
})
