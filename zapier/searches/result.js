'use strict'

const { url, raiseForStatus } = require('../lib/http')

module.exports = {
  key: 'find_result',
  noun: 'Result',
  display: {
    label: 'Find Result',
    description: 'Gets one assessment result with its AI evaluation: score, summary, strengths and gaps.'
  },
  operation: {
    inputFields: [{ key: 'submission_id', label: 'Result ID', required: true }],
    perform: async (z, bundle) => {
      const response = await z.request({
        url: url(`/hiring/submissions/${encodeURIComponent(bundle.inputData.submission_id)}/detail/v1`),
        skipThrowForStatus: true
      })
      if (response.status === 404) return []
      raiseForStatus(response, z)
      return [response.data]
    },
    sample: {
      id: '59065d06-a013-44c2-97d2-88e9d6b3c858',
      submission_id: '59065d06-a013-44c2-97d2-88e9d6b3c858',
      assessment_type: 'ai_interview',
      assessment_name: 'AI Engineer - AI Interview',
      candidate_name: 'Alex Kim',
      email: 'alex@example.com',
      overall_score: 7.2,
      score_status: 'scored',
      submission_at: '2026-09-10T12:00:49.000Z',
      evaluation: { summary: 'A strong applied engineer who has shipped retrieval systems end to end.', overall_rating: 7.2 }
    }
  }
}
