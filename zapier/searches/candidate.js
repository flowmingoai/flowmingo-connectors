'use strict'

const { url } = require('../lib/http')

module.exports = {
  key: 'find_candidate',
  noun: 'Candidate',
  display: { label: 'Find Candidate', description: 'Finds a candidate in your pipelines by email address.' },
  operation: {
    inputFields: [{ key: 'email', label: 'Email', required: true, helpText: 'Matched exactly, ignoring capital letters.' }],
    perform: async (z, bundle) => {
      const email = String(bundle.inputData.email || '').trim()
      const response = await z.request({ url: url('/hiring/candidates/v1'), params: { email, limit: 10 } })
      const rows = Array.isArray(response.data && response.data.data) ? response.data.data : []
      // The docs ask callers to compare the address before treating a row as a match (§5.6).
      return rows.filter((row) => typeof row.email === 'string' && row.email.toLowerCase() === email.toLowerCase())
    },
    sample: {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      firstname: 'Alex',
      lastname: 'Kim',
      email: 'alex@example.com',
      cv_link: 'https://data.flowmingo.ai/cv/alex.pdf',
      created_at: '2026-10-19T08:30:00.000Z'
    }
  }
}
