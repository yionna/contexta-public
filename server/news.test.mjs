import test from 'node:test'
import assert from 'node:assert/strict'
import { isDirectPublisherUrl } from './news.mjs'

test('only publisher URLs satisfy the public feed contract', () => {
  assert.equal(isDirectPublisherUrl('https://news.google.com/rss/articles/example'), false)
  assert.equal(isDirectPublisherUrl('https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fexample.com'), false)
  assert.equal(isDirectPublisherUrl('https://news.mit.edu/2026/example-ai-story'), true)
  assert.equal(isDirectPublisherUrl('not a url'), false)
})
