'use strict'

const { url } = require('../lib/http')
const { toBoolean, toNumber, compact } = require('../lib/fields')

const submissionIdField = {
  key: 'submission_id',
  label: 'Result ID',
  required: true,
  helpText: 'The result (submission) id, for example from the AI Evaluation Ready or Assessment Completed trigger.'
}

const post = async (z, bundle, action, body) => {
  const response = await z.request({
    url: url(`/hiring/submissions/${encodeURIComponent(bundle.inputData.submission_id)}/${action}/v1`),
    method: 'POST',
    body
  })
  return response.data
}

const ratingNumber = (z, value, isRequired) => {
  const rating = toNumber(value)
  if (rating === undefined && isRequired) throw new z.errors.Error('Rating must be a number from 0 to 10.', 'invalid_input', 400)
  return rating
}

const addNote = {
  key: 'add_note',
  noun: 'Note',
  display: {
    label: 'Add Note to Result',
    description: 'Adds a note, and optionally a rating, to a result under the name of the person who created the API key.'
  },
  operation: {
    inputFields: [
      submissionIdField,
      { key: 'note', label: 'Note', type: 'text', required: true, helpText: '1 to 2000 characters.' },
      { key: 'rating', label: 'Rating', type: 'number', required: false, helpText: '0.5 to 10, in steps of 0.5.' }
    ],
    perform: (z, bundle) =>
      post(z, bundle, 'note', compact({ note: bundle.inputData.note, rating: ratingNumber(z, bundle.inputData.rating, false) })),
    sample: {
      id: 'eca87aad-100e-4fe3-848e-83d55b07c78f',
      note: 'Strong systems thinking; ask about on-call experience.',
      rating: 8,
      created_at: '2026-10-20T09:41:12.000Z'
    }
  }
}

const rate = {
  key: 'rate_result',
  noun: 'Rating',
  display: { label: 'Rate Result', description: 'Rates a result from 0 to 10, replacing the earlier rating by the same person.' },
  operation: {
    inputFields: [
      submissionIdField,
      { key: 'rating', label: 'Rating', type: 'number', required: true, helpText: '0 to 10, in steps of 0.5.' }
    ],
    perform: (z, bundle) => post(z, bundle, 'rate', { rating: ratingNumber(z, bundle.inputData.rating, true) }),
    sample: { id: '7241c51b-23a7-4072-b345-5484cd0b54af', rating: 8, rated_at: '2026-10-20T09:42:03.000Z' }
  }
}

const shortlist = {
  key: 'shortlist_result',
  noun: 'Shortlist',
  display: { label: 'Shortlist Result', description: 'Shortlists a result, or removes the shortlist mark.' },
  operation: {
    inputFields: [
      submissionIdField,
      { key: 'shortlisted', label: 'Shortlisted', type: 'boolean', required: true, default: 'true' }
    ],
    perform: (z, bundle) => post(z, bundle, 'shortlist', { shortlisted: toBoolean(bundle.inputData.shortlisted, true) }),
    sample: { id: 'b2cf0e3f-215b-483d-97f2-4078f18bf619', shortlisted: true }
  }
}

module.exports = [addNote, rate, shortlist]
