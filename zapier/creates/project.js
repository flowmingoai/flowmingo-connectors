'use strict'

const { url } = require('../lib/http')
const { compact } = require('../lib/fields')

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/

module.exports = {
  key: 'create_project',
  noun: 'Project',
  display: {
    label: 'Create Hiring Project',
    description:
      'Creates a hiring project with its four default stages and an AI-drafted job post. Assessments are added in Flowmingo afterwards.'
  },
  operation: {
    inputFields: [
      { key: 'title', label: 'Project Title', required: true, helpText: 'How your team sees the project, up to 255 characters.' },
      { key: 'position', label: 'Position', required: true, helpText: 'The role being hired for. It becomes the job post title.' },
      {
        key: 'description',
        label: 'Job Description',
        type: 'text',
        required: false,
        helpText: 'The job description as text, up to 15000 characters. The job post is drafted from it.'
      },
      {
        key: 'idempotency_key',
        label: 'Unique Key',
        required: true,
        helpText:
          'An id of this job in your own system, 8 to 128 characters from A-Z a-z 0-9 . _ : -. Sending the same key again returns the same project instead of a second one.'
      }
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData
      if (!IDEMPOTENCY_KEY.test(String(input.idempotency_key || ''))) {
        throw new z.errors.Error(
          'Unique Key must be 8 to 128 characters from A-Z a-z 0-9 . _ : -',
          'invalid_input',
          400
        )
      }
      // assessments: [] keeps the call to a few seconds; making them takes up to 45 s, past Zapier's step timeout.
      const response = await z.request({
        url: url('/hiring/projects/v1'),
        method: 'POST',
        body: compact({
          title: input.title,
          position: input.position,
          description: input.description,
          idempotency_key: input.idempotency_key,
          assessments: []
        })
      })
      const project = response.data || {}
      return { ...project, job_post_id: project.job_post ? project.job_post.id ?? null : null }
    },
    sample: {
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'Support Engineer - Q4 hiring',
      position: 'Support Engineer',
      status: 'active',
      source: 'api',
      created_at: '2026-10-22T04:18:44.051Z',
      stages: [
        { id: 'b0b0b0b0-abcd-4ef0-8123-456789abcdef', name: 'Unassigned' },
        { id: '1d2c3b4a-5f6e-4d7c-9b8a-0a1b2c3d4e5f', name: 'Shortlisted' },
        { id: '2e3d4c5b-6a7f-4e8d-8c9b-1b2c3d4e5f60', name: 'In Progress' },
        { id: '3f4e5d6c-7b8a-4f9e-a0dc-2c3d4e5f6071', name: 'Rejected' }
      ],
      job_post: { id: 'c0ffee00-dead-4bee-8f00-0123456789ab', status: 'active' },
      job_post_id: 'c0ffee00-dead-4bee-8f00-0123456789ab',
      idempotent_replay: false,
      missing_details: ['locations']
    }
  }
}
