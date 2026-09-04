import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPersonaSurfaceStyle, cleanRecentMessages, formatRecentMessages, isMissedSocialRepair, isRepeatedReply, isSocialRepairMessage, personaFailureFallback, personaRepairFallback, stableBucket, stripConversationEcho } from './persona-routing.mjs'

test('detects interpersonal repair messages', () => {
  for (const message of ['@Ren wow. the attitude', 'your tone was rude', 'you were being cold', 'why are you ignoring me?', 'you went silent', 'you left me hanging', 'chill bro', 'u ok?']) {
    assert.equal(isSocialRepairMessage(message), true, message)
  }
})

test('does not mistake ordinary news language for interpersonal repair', () => {
  for (const message of ['Cold War-era export controls are back', 'there has been silence from the White House', 'wow, that is a huge funding round', 'the public attitude toward AI is changing', 'silent inference is getting cheaper']) {
    assert.equal(isSocialRepairMessage(message), false, message)
  }
})

test('retries only bare non-responses, not concise social replies', () => {
  for (const reply of ['Okay.', 'fine', 'Noted.']) assert.equal(isMissedSocialRepair(reply), true, reply)
  for (const reply of ['fair enough', 'my bad', 'fair.', 'yeah, that was cold of me']) assert.equal(isMissedSocialRepair(reply), false, reply)
})

test('uses distinct failure fallbacks and stable buckets', () => {
  assert.notEqual(personaFailureFallback('Mika'), personaFailureFallback('Ren'))
  assert.match(personaFailureFallback('Lil Bot'), /taskbar/)
  assert.equal(stableBucket('same input', 8), stableBucket('same input', 8))
  assert.match(personaRepairFallback('Sora'), /framing/)
})

test('rejects echoes and repeated persona lines without rejecting a new move', () => {
  const recent = ['Mika: sure, but nobody actually knows what happened. anyway.', 'you: dystopia LOL']
  assert.equal(isRepeatedReply('sure, but nobody actually knows what happened. anyway.', 'dystopia LOL', recent), true)
  assert.equal(isRepeatedReply('dystopia LOL', 'dystopia LOL', recent), true)
  assert.equal(isRepeatedReply('So the demo happens, then what? what... that is an essay', 'what... that is an essay', ['Sora: So the demo happens, then what?']), true)
  assert.equal(isRepeatedReply('the water story is less cyberpunk and more infrastructure accounting', 'dystopia LOL', recent), false)
})

test('keeps the newest structured conversation turns and their reply target', () => {
  const history = Array.from({ length: 18 }, (_, index) => ({ author: index % 2 ? 'Mika' : 'you', text: `turn ${index}` }))
  history[17] = { author: 'you', text: 'see??', replyToAuthor: 'Lil Bot', replyToText: 'The essay argues that AI changes social expectations.' }
  const recent = cleanRecentMessages(history, 14)
  assert.equal(recent.length, 14)
  assert.equal(recent[0].text, 'turn 4')
  assert.equal(recent.at(-1).text, 'see??')
  assert.match(formatRecentMessages(recent), /you \(replying to Lil Bot:.*essay argues.*\): see\?\?/)
})

test('removes serialized speaker echoes without removing the actual answer', () => {
  assert.equal(stripConversationEcho('you@Lil Bot explain\nThe article studies how learners understand explanations.', '@Lil Bot explain', [{ author: 'you', text: '@Lil Bot explain' }]), 'The article studies how learners understand explanations.')
  assert.equal(stripConversationEcho('RenOkay, wait.\nThe business question is who pays for deployment.', 'what do you think?', [{ author: 'Ren', text: 'Okay, wait.' }]), 'The business question is who pays for deployment.')
  assert.equal(stripConversationEcho('youhi mika, how would u design this\nstart with the interaction flow.', 'hi mika, how would u design this', []), 'start with the interaction flow.')
})

test('enforces visible persona style without changing the underlying point', () => {
  assert.equal(applyPersonaSurfaceStyle('Ren', 'Ren: The metric moved.'), 'The metric moved.')
  assert.equal(applyPersonaSurfaceStyle('Ren', '(Ren: The metric moved.)'), 'The metric moved.')
  assert.equal(applyPersonaSurfaceStyle('Ren', 'Ren is right about the metric.'), 'Ren is right about the metric.')
  assert.equal(applyPersonaSurfaceStyle('Mika', 'Try this — then test it.'), 'try this, then test it.')
  assert.equal(applyPersonaSurfaceStyle('Ren', 'The metric moved — the task did not.'), 'The metric moved, the task did not.')
  assert.equal(applyPersonaSurfaceStyle('Sora', 'who benefits?'), 'Who benefits?')
  assert.match(applyPersonaSurfaceStyle('Jules', 'The margin moved.', 0), /[😅👀🤔]$/u)
  assert.equal(applyPersonaSurfaceStyle('Jules', 'The margin moved.', 4), 'The margin moved.')
})
