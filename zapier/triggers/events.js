'use strict'

const contract = require('../lib/contract.json')
const { url } = require('../lib/http')
const hydrators = require('../lib/hydrators')

const PAGE_SIZE = 100

// One feed item becomes one Zapier item: the payload's fields at the top, the envelope beside them, and `id` set to
// the event id so Zapier's dedupe never runs a Zap twice for one event.
const toItem = (z, event, definition) => {
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const item = {
    ...data,
    id: event.event_id,
    event_id: event.event_id,
    event_type: event.event_type,
    sub_event: event.sub_event ?? null,
    timestamp: event.timestamp
  }
  const candidateId = definition.candidate_id_field && data[definition.candidate_id_field]
  if (candidateId) item.candidate = z.dehydrate(hydrators.getCandidate, { id: candidateId })
  const submissionId = definition.submission_id_field && data[definition.submission_id_field]
  if (submissionId) item.result = z.dehydrate(hydrators.getResult, { id: submissionId })
  return item
}

const buildTrigger = (definition) => {
  const inputFields = []
  if (definition.sub_event_field) {
    inputFields.push({
      key: definition.sub_event_field,
      label: definition.sub_event_field === 'assessment_type' ? 'Assessment Type' : 'Only When',
      required: false,
      choices: definition.sub_event_choices,
      helpText: 'Leave empty to trigger on every kind.'
    })
  }

  const perform = async (z, bundle) => {
    const response = await z.request({
      url: url(contract.events_feed.path),
      params: { event_type: definition.event_type, limit: PAGE_SIZE }
    })
    const events = Array.isArray(response.data && response.data.data) ? response.data.data : []
    const wanted = definition.sub_event_field && bundle.inputData[definition.sub_event_field]
    return events
      .filter((event) => event && event.event_type === definition.event_type && event.event_id)
      .filter((event) => !wanted || (event.data && event.data[definition.sub_event_field] === wanted))
      .map((event) => toItem(z, event, definition))
  }

  return {
    key: definition.key,
    noun: definition.noun,
    display: { label: definition.label, description: definition.description },
    operation: {
      type: 'polling',
      inputFields,
      perform,
      sample: {
        id: 'cca11cbd-00fd-4e16-ba60-75625ee9d196',
        event_id: 'cca11cbd-00fd-4e16-ba60-75625ee9d196',
        event_type: definition.event_type,
        sub_event: definition.sub_event_field ? definition.sample[definition.sub_event_field] : null,
        timestamp: '2026-10-20T09:15:30.123Z',
        ...definition.sample
      }
    }
  }
}

module.exports = contract.events.map(buildTrigger)
