'use strict'

const { url, raiseForStatus } = require('./http')

// Hydrators run only when a later step of the Zap uses the field, and only for new items, so an event page costs one
// request however many candidates it names. A key without read_candidates gets a clear note instead of a failed Zap.
const UNAVAILABLE = {
  403: 'The API key lacks the read_candidates scope.',
  404: 'Flowmingo returned no details for this id.'
}

const fetchOrExplain = async (z, path) => {
  const response = await z.request({ url: url(path), skipThrowForStatus: true })
  if (UNAVAILABLE[response.status]) return { available: false, reason: UNAVAILABLE[response.status] }
  raiseForStatus(response, z)
  return { available: true, ...response.data }
}

const getCandidate = (z, bundle) =>
  fetchOrExplain(z, `/hiring/candidates/${encodeURIComponent(bundle.inputData.id)}/v1`)

const getResult = (z, bundle) =>
  fetchOrExplain(z, `/hiring/submissions/${encodeURIComponent(bundle.inputData.id)}/detail/v1`)

module.exports = { getCandidate, getResult }
