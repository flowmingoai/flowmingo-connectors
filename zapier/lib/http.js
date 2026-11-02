'use strict'

const contract = require('./contract.json')
const { version } = require('../package.json')

// Zapier publishes production endpoints only; the override exists for local tests against a non-production stack.
const BASE_URL = process.env.FLOWMINGO_BASE_URL || contract.base_url
const USER_AGENT = `flowmingo-zapier/${version}`

const url = (path) => `${BASE_URL}${path}`

const addApiKey = (request, z, bundle) => {
  request.headers = request.headers || {}
  request.headers['x-api-key'] = bundle.authData.api_key
  request.headers['user-agent'] = USER_AGENT
  request.headers.accept = 'application/json'
  return request
}

const parseBody = (response) => {
  try {
    return typeof response.content === 'string' && response.content ? JSON.parse(response.content) : {}
  } catch (error) {
    return {}
  }
}

const retryAfterSeconds = (response, fallback) => {
  const header = Number(response.getHeader && response.getHeader('retry-after'))
  return Number.isFinite(header) && header > 0 ? header : fallback
}

// The API answers every error as { statusCode, message, code? } (docs §8.4): surface the message, branch on status and code only.
const raiseForStatus = (response, z) => {
  if (response.status < 400) return response
  const body = parseBody(response)
  const message = typeof body.message === 'string' ? body.message : `Flowmingo answered ${response.status}`
  const code = typeof body.code === 'string' ? body.code : `http_${response.status}`

  if (response.status === 401) {
    throw new z.errors.ExpiredAuthError(
      'Flowmingo did not accept the API key. It may have been revoked or disabled: reconnect with a valid key from Settings, API keys.'
    )
  }
  if (response.status === 429 || (response.status === 503 && body.code)) {
    throw new z.errors.ThrottledError(message, retryAfterSeconds(response, 60))
  }
  throw new z.errors.Error(message, code, response.status)
}

// A caller that reads the status itself (a search that treats 404 as "nothing found") asks for no throw, then calls
// raiseForStatus for every other status.
const handleErrors = (response, z) =>
  response.request && response.request.skipThrowForStatus ? response : raiseForStatus(response, z)

module.exports = { BASE_URL, USER_AGENT, url, addApiKey, handleErrors, raiseForStatus }
