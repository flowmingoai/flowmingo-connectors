'use strict'

const contract = require('../lib/contract.json')
const { url } = require('../lib/http')

// Hidden triggers that feed the dropdowns of the actions. Zapier counts dropdown pages from 0; the API from 1.
const LIST_LIMIT = 100

const listPage = async (z, bundle, path, params = {}) => {
  const response = await z.request({
    url: url(path),
    params: { page: (bundle.meta && bundle.meta.page ? bundle.meta.page : 0) + 1, limit: LIST_LIMIT, ...params }
  })
  return Array.isArray(response.data && response.data.data) ? response.data.data : []
}

const hidden = (key, noun, label, perform, inputFields = [], canPaginate = true) => ({
  key,
  noun,
  display: { label, description: `Lists ${noun.toLowerCase()}s for dropdowns.`, hidden: true },
  operation: { type: 'polling', canPaginate, inputFields, perform }
})

const projects = hidden('project_list', 'Project', 'Hiring Projects', (z, bundle) =>
  listPage(z, bundle, '/hiring/projects/v1')
)

// Only the kinds the invite route can send: a Showcase, Recording, Questionnaire or question bank answers 400.
// A draft, inactive or archived one is still listed (it can be invited) but says so: its invitation is not emailed until it is active.
const invitableSetTypes = new Set(Object.keys(contract.invitable_set_types).map(Number))
const assessments = hidden('assessment_list', 'Assessment', 'Assessments', async (z, bundle) => {
  const rows = await listPage(z, bundle, '/hiring/interview-sets/v1')
  return rows
    .filter((row) => row.set_type === null || row.set_type === undefined || invitableSetTypes.has(row.set_type))
    .map((row) => {
      const tags = [contract.invitable_set_types[row.set_type], contract.inactive_set_statuses[row.status]].filter(Boolean)
      return { ...row, label: `${row.title}${tags.length ? ` (${tags.join(', ')})` : ''}` }
    })
})

const jobPosts = hidden(
  'job_post_list',
  'Job Post',
  'Job Posts',
  (z, bundle) =>
    listPage(
      z,
      bundle,
      '/hiring/job-posts/v1',
      bundle.inputData.com_project_id ? { com_project_id: bundle.inputData.com_project_id } : {}
    ),
  [{ key: 'com_project_id', label: 'Hiring Project', dynamic: 'project_list.id.title', required: false }]
)

// The stage list is not paged and answers an empty list for an unknown project.
const stages = hidden(
  'stage_list',
  'Stage',
  'Stages',
  async (z, bundle) => {
    if (!bundle.inputData.com_project_id) return []
    const response = await z.request({
      url: url(`/hiring/projects/${encodeURIComponent(bundle.inputData.com_project_id)}/stages/v1`)
    })
    return Array.isArray(response.data && response.data.data) ? response.data.data : []
  },
  [{ key: 'com_project_id', label: 'Hiring Project', dynamic: 'project_list.id.title', required: false }],
  false
)

module.exports = [projects, assessments, jobPosts, stages]
