import { PROMPT_VERSION } from './prompts.mjs'

export class AiError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'AiError'; this.status = status }
}

export function createAiClient(config) {
  const directText = (message) => {
    if (typeof message?.content === 'string' && message.content.trim()) return message.content
    // Cloudflare's Qwen OpenAI-compat response currently places /no_think final
    // output in both reasoning fields while returning content:null. Requiring the
    // fields to agree avoids treating an actual private trace as the final answer.
    if (typeof message?.reasoning === 'string' && message.reasoning.trim() && message.reasoning === message.reasoning_content) return message.reasoning
    return ''
  }
  async function request(path, body) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25_000)
    try {
      const response = await fetch(`${config.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        // Do not return provider bodies: they may echo request material or operational details.
        if (response.status === 429) throw new AiError('The AI free-tier rate limit is temporarily exhausted.', 429)
        if (response.status === 401 || response.status === 403) throw new AiError('The AI provider rejected the server credentials or quota.', 503)
        throw new AiError(`The AI provider returned status ${response.status}.`)
      }
      return response.json()
    } catch (error) {
      if (error instanceof AiError) throw error
      if (error?.name === 'AbortError') throw new AiError('The AI provider timed out.', 504)
      throw new AiError('The AI provider could not be reached.')
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async chat({ system, user, history = [], temperature = 0.2, maxTokens = config.maxOutputTokens }) {
      const payload = {
        model: config.generationModel,
        messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: `${user}\n\n/no_think` }],
        temperature,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      }
      let data = await request('/chat/completions', payload)
      let text = directText(data?.choices?.[0]?.message)
      // Some reasoning-model responses consume their completion budget in hidden reasoning.
      // Retry once explicitly requesting a direct final answer; never expose chain-of-thought.
      if (typeof text !== 'string' || !text.trim()) {
        data = await request('/chat/completions', { ...payload, max_tokens: Math.max(maxTokens, 900), messages: [...payload.messages, { role: 'user', content: 'Give the final answer now without showing private reasoning.' }] })
        text = directText(data?.choices?.[0]?.message)
      }
      if (typeof text !== 'string' || !text.trim()) throw new AiError('The model did not produce a final answer. Please retry.')
      let finishReason = data?.choices?.[0]?.finish_reason
      let continuations = 0
      while (finishReason === 'length' && continuations < 2) {
        const continuation = await request('/chat/completions', { ...payload, max_tokens: maxTokens, messages: [...payload.messages, { role: 'assistant', content: text }, { role: 'user', content: 'Continue exactly where you stopped. Complete every remaining section without repeating earlier text.' }] })
        const nextText = directText(continuation?.choices?.[0]?.message)
        if (typeof nextText !== 'string' || !nextText.trim()) break
        text = `${text.trimEnd()}\n\n${nextText.trim()}`
        finishReason = continuation?.choices?.[0]?.finish_reason
        data = continuation
        continuations += 1
      }
      return { text: text.trim(), model: data.model ?? config.generationModel, usage: data.usage ?? null, promptVersion: PROMPT_VERSION, finishReason }
    },
    async embed(input) {
      const data = await request('/embeddings', { model: config.embeddingModel, input })
      const vector = data?.data?.[0]?.embedding
      if (!Array.isArray(vector) || vector.length !== config.embeddingDimensions) throw new AiError('The embedding response had an unexpected dimension.')
      return { vector, model: data.model ?? config.embeddingModel }
    },
  }
}
