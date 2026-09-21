/**
 * TypeSafeAI Jev System-1 Client Adapter.
 * Implements the exact same `systemOne(state, questions)` interface as Convai Laya,
 * routing requests to `https://api.typesafe.ai/v1/systemone`.
 */

export class TypeSafeJevClient {
  constructor(apiKey, endpoint = 'https://api.typesafe.ai/v1/systemone', model = 'jev-latest') {
    this.apiKey = apiKey || process.env.TYPESAFE_API_KEY
    this.endpoint = endpoint
    this.model = model
  }

  /**
   * Evaluates questions against state in one forward pass via TypeSafe Jev API.
   *
   * @param {object|string} state
   * @param {Record<string, object>} questions
   * @returns {Promise<object>}
   */
  async systemOne(state, questions) {
    let statePayload = state
    if (typeof state === 'object' && state !== null) {
      if (state.target_turn?.text) {
        statePayload = state.target_turn.text
      }
      else {
        statePayload = JSON.stringify(state)
      }
    }

    const payload = {
      model: this.model,
      state: statePayload,
      questions,
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`[TypeSafeJev] API error ${res.status}: ${errText}`)
    }

    const data = await res.json()
    return data
  }

  async close() {
    // No-op for HTTP client
  }
}
