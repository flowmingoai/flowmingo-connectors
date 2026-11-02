'use strict'

const fs = require('fs')
const path = require('path')
const nock = require('nock')
const zapier = require('zapier-platform-core')

const App = require('../index')
const { validateApp, prepareApp } = require('zapier-platform-core/src/tools/schema')

const appTester = zapier.createAppTester(App)
const BASE = 'https://apis.flowmingo.ai'
const PREFIX = '/company/integration'
const KEY = 'fl_test_abc.123'

const bundle = (inputData = {}, meta = {}) => ({ authData: { api_key: KEY }, inputData, meta })
const api = () => nock(BASE, { reqheaders: { 'x-api-key': KEY } })

const event = (eventType, data, id = 'e1') => ({
  event_id: id,
  event_type: eventType,
  sub_event: null,
  timestamp: '2026-10-20T09:15:30.123Z',
  data
})

beforeAll(() => nock.disableNetConnect())
afterEach(() => {
  expect(nock.isDone()).toBe(true)
  nock.cleanAll()
})

describe('app definition', () => {
  it('should pass the Zapier schema', () => {
    expect(validateApp(prepareApp(App))).toEqual([])
  })

  it('should bundle a contract identical to shared/contract.json', () => {
    const shared = fs.readFileSync(path.join(__dirname, '../../shared/contract.json'), 'utf8')
    const bundled = fs.readFileSync(path.join(__dirname, '../lib/contract.json'), 'utf8')
    expect(bundled).toBe(shared)
  })
})

describe('authentication', () => {
  it('should test the key on /me/v1 and identify the connector', async () => {
    api()
      .matchHeader('user-agent', /^flowmingo-zapier\//)
      .get(`${PREFIX}/me/v1`)
      .reply(200, { api_key_id: 'k1', organization_id: 42, scopes: ['read_hiring'] })

    const result = await appTester(App.authentication.test, bundle())

    expect(result.organization_id).toBe(42)
  })

  it('should mark the connection expired on 401', async () => {
    api().get(`${PREFIX}/me/v1`).reply(401, { statusCode: 401, message: 'Invalid API key' })

    await expect(appTester(App.authentication.test, bundle())).rejects.toThrow(/did not accept the API key/)
  })
})

describe('event triggers', () => {
  it('should poll the feed for its own event type and dedupe on the event id', async () => {
    api()
      .get(`${PREFIX}/events/v1`)
      .query({ event_type: 'application.created', limit: 100 })
      .reply(200, {
        data: [event('application.created', { application_id: 'a1', tal_candidate_id: 'c1' })],
        next_cursor: null
      })

    const items = await appTester(App.triggers.application_created.operation.perform, bundle())

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'e1', event_id: 'e1', event_type: 'application.created', application_id: 'a1' })
    expect(items[0].candidate).toMatch(/hydrate/)
  })

  it('should keep only the chosen assessment type and attach the result for hydration', async () => {
    api()
      .get(`${PREFIX}/events/v1`)
      .query({ event_type: 'assessment.completed', limit: 100 })
      .reply(200, {
        data: [
          event('assessment.completed', { assessment_type: 'skill_test', submission_id: 's1' }, 'e1'),
          event('assessment.completed', { assessment_type: 'showcase', submission_id: 's2' }, 'e2')
        ],
        next_cursor: 'older'
      })

    const items = await appTester(
      App.triggers.assessment_completed.operation.perform,
      bundle({ assessment_type: 'skill_test' })
    )

    expect(items.map((item) => item.id)).toEqual(['e1'])
    expect(items[0].result).toMatch(/hydrate/)
  })

  it('should drop items of another event type or without an id', async () => {
    api()
      .get(`${PREFIX}/events/v1`)
      .query(true)
      .reply(200, {
        data: [event('candidate.stage_changed', {}, 'e1'), event('application.rejected', {}, ''), event('application.rejected', {}, 'e3')],
        next_cursor: null
      })

    const items = await appTester(App.triggers.application_rejected.operation.perform, bundle())

    expect(items.map((item) => item.id)).toEqual(['e3'])
  })

  it('should ask Zapier to retry later on 429', async () => {
    api()
      .get(`${PREFIX}/events/v1`)
      .query(true)
      .reply(429, { statusCode: 429, code: 'api_key_rate_limited', message: 'Wait 12 seconds' }, { 'Retry-After': '12' })

    await expect(appTester(App.triggers.application_created.operation.perform, bundle())).rejects.toMatchObject({
      name: 'ThrottledError'
    })
  })

  it('should surface the API message and code on other errors', async () => {
    api()
      .get(`${PREFIX}/events/v1`)
      .query(true)
      .reply(403, { statusCode: 403, message: 'This feed covers the whole company' })

    await expect(appTester(App.triggers.application_created.operation.perform, bundle())).rejects.toThrow(
      /This feed covers the whole company/
    )
  })
})

describe('dropdown lists', () => {
  it('should page from 1 and list only assessments the invite route can send', async () => {
    api()
      .get(`${PREFIX}/hiring/interview-sets/v1`)
      .query({ page: 2, limit: 100 })
      .reply(200, {
        data: [
          { id: 'i1', title: 'Sales', set_type: 1 },
          { id: 'i2', title: 'Portfolio', set_type: 4 },
          { id: 'i3', title: 'Legacy', set_type: null }
        ],
        total: 3
      })

    const rows = await appTester(App.triggers.assessment_list.operation.perform, bundle({}, { page: 1 }))

    expect(rows.map((row) => row.id)).toEqual(['i1', 'i3'])
    expect(rows[0].label).toBe('Sales (AI Interview)')
  })

  it('should list no stages until a project is picked', async () => {
    const rows = await appTester(App.triggers.stage_list.operation.perform, bundle())

    expect(rows).toEqual([])
  })

  it("should list the picked project's stages", async () => {
    api()
      .get(`${PREFIX}/hiring/projects/p1/stages/v1`)
      .reply(200, { data: [{ id: 's1', name: 'Unassigned' }] })

    const rows = await appTester(App.triggers.stage_list.operation.perform, bundle({ com_project_id: 'p1' }))

    expect(rows).toEqual([{ id: 's1', name: 'Unassigned' }])
  })
})

describe('invite candidate', () => {
  const perform = App.creates.invite_candidate.operation.perform

  it('should send arrays and a real boolean, and flatten the result', async () => {
    api()
      .post(`${PREFIX}/interview/candidate/invite/v1`, {
        com_interview_set_ids: ['i1'],
        com_project_ids: ['p1'],
        candidates: [{ email: 'alex@example.com', firstname: 'Alex' }],
        send_invite: false
      })
      .reply(201, {
        results: [
          {
            email_address: 'alex@example.com',
            invitations: [{ id: 'inv1', tal_candidate_id: 'c1', status_text: 'pending' }],
            applications: [{ id: 'app1', tal_candidate_id: 'c1' }],
            submissions: [{ id: 'sub1', status_text: 'need_interview' }]
          }
        ]
      })

    const result = await appTester(
      perform,
      bundle({ com_interview_set_id: 'i1', com_project_id: 'p1', email: 'alex@example.com', firstname: 'Alex', send_invite: 'false' })
    )

    expect(result).toEqual({
      email: 'alex@example.com',
      tal_candidate_id: 'c1',
      invitation_id: 'inv1',
      invitation_status: 'pending',
      application_id: 'app1',
      submission_id: 'sub1',
      submission_status: 'need_interview',
      warnings: null
    })
  })

  it('should fail the step when a 201 created nothing for the candidate', async () => {
    api()
      .post(`${PREFIX}/interview/candidate/invite/v1`)
      .reply(201, { results: [{ email_address: 'alex@example.com', invitation_error_messages: { i1: 'Email already invited' } }] })

    await expect(appTester(perform, bundle({ com_interview_set_id: 'i1', email: 'alex@example.com' }))).rejects.toThrow(
      /Email already invited/
    )
  })

  it('should report a partial refusal as a warning', async () => {
    api()
      .post(`${PREFIX}/interview/candidate/invite/v1`)
      .reply(201, {
        results: [
          {
            invitations: [{ id: 'inv1', tal_candidate_id: 'c1' }],
            application_error_messages: { p1: 'Candidate has already applied to this project' }
          }
        ]
      })

    const result = await appTester(perform, bundle({ com_interview_set_id: 'i1', com_project_id: 'p1', email: 'a@b.co' }))

    expect(result.invitation_id).toBe('inv1')
    expect(result.warnings).toBe('Candidate has already applied to this project')
  })

  it('should refuse without an assessment or a project, before calling the API', async () => {
    await expect(appTester(perform, bundle({ email: 'a@b.co' }))).rejects.toThrow(/assessment, a hiring project/)
  })

  it('should refuse without an email or a CV link, before calling the API', async () => {
    await expect(appTester(perform, bundle({ com_project_id: 'p1' }))).rejects.toThrow(/email or a CV link/)
  })
})

describe('pipeline actions', () => {
  it('should add an existing candidate without empty optional fields', async () => {
    api()
      .post(`${PREFIX}/hiring/applications/v1`, { tal_candidate_id: 'c1', com_project_id: 'p1' })
      .reply(201, { id: 'app1', com_project_id: 'p1', status: 1 })

    const result = await appTester(
      App.creates.add_application.operation.perform,
      bundle({ tal_candidate_id: 'c1', com_project_id: 'p1', com_job_post_id: '', com_stage_id: '' })
    )

    expect(result.id).toBe('app1')
  })

  it('should move an application by its id with the stage only', async () => {
    api()
      .post(`${PREFIX}/hiring/applications/app1/move-stage/v1`, { com_stage_id: 's2' })
      .reply(201, { id: 'app1', com_stage_id: 's2' })

    const result = await appTester(
      App.creates.move_application_stage.operation.perform,
      bundle({ application_id: 'app1', com_project_id: 'p1', com_stage_id: 's2' })
    )

    expect(result.com_stage_id).toBe('s2')
  })

  it('should reject an application', async () => {
    api().post(`${PREFIX}/hiring/applications/app1/reject/v1`).reply(201, { id: 'app1', status: 'rejected' })

    const result = await appTester(App.creates.reject_application.operation.perform, bundle({ application_id: 'app1' }))

    expect(result.status).toBe('rejected')
  })
})

describe('review actions', () => {
  it('should send a rating as a JSON number', async () => {
    api().post(`${PREFIX}/hiring/submissions/s1/rate/v1`, { rating: 7.5 }).reply(201, { id: 'r1', rating: 7.5 })

    const result = await appTester(App.creates.rate_result.operation.perform, bundle({ submission_id: 's1', rating: '7.5' }))

    expect(result.rating).toBe(7.5)
  })

  it('should refuse a rating that is not a number', async () => {
    await expect(
      appTester(App.creates.rate_result.operation.perform, bundle({ submission_id: 's1', rating: 'great' }))
    ).rejects.toThrow(/Rating must be a number/)
  })

  it('should refuse a note whose optional rating is given but is not a number', async () => {
    await expect(
      appTester(App.creates.add_note.operation.perform, bundle({ submission_id: 's1', note: 'Fine.', rating: 'great' }))
    ).rejects.toThrow(/Rating must be a number/)
  })

  it('should add a note without a rating when none is given', async () => {
    api().post(`${PREFIX}/hiring/submissions/s1/note/v1`, { note: 'Strong answers.' }).reply(201, { id: 'n1' })

    await appTester(App.creates.add_note.operation.perform, bundle({ submission_id: 's1', note: 'Strong answers.', rating: '' }))
  })

  it('should send shortlisted as a JSON boolean', async () => {
    api().post(`${PREFIX}/hiring/submissions/s1/shortlist/v1`, { shortlisted: false }).reply(201, { id: 'x', shortlisted: false })

    await appTester(App.creates.shortlist_result.operation.perform, bundle({ submission_id: 's1', shortlisted: 'false' }))
  })
})

describe('create hiring project', () => {
  const perform = App.creates.create_project.operation.perform

  it('should create the project alone, with the caller key, and expose the job post id', async () => {
    api()
      .post(`${PREFIX}/hiring/projects/v1`, {
        title: 'Support Q4',
        position: 'Support Engineer',
        idempotency_key: 'ats-job-48213',
        assessments: []
      })
      .reply(201, { id: 'p1', job_post: { id: 'jp1', status: 'active' } })

    const result = await appTester(
      perform,
      bundle({ title: 'Support Q4', position: 'Support Engineer', idempotency_key: 'ats-job-48213' })
    )

    expect(result.job_post_id).toBe('jp1')
  })

  it('should refuse a malformed unique key before calling the API', async () => {
    await expect(
      appTester(perform, bundle({ title: 'T', position: 'P', idempotency_key: 'short' }))
    ).rejects.toThrow(/Unique Key/)
  })
})

describe('searches', () => {
  it('should return only rows whose email matches, ignoring case', async () => {
    api()
      .get(`${PREFIX}/hiring/candidates/v1`)
      .query({ email: 'Alex@Example.com', limit: 10 })
      .reply(200, { data: [{ id: 'c1', email: 'alex@example.com' }, { id: 'c2', email: 'other@example.com' }], total: 2 })

    const rows = await appTester(App.searches.find_candidate.operation.perform, bundle({ email: ' Alex@Example.com ' }))

    expect(rows.map((row) => row.id)).toEqual(['c1'])
  })

  it('should find nothing for an unknown result', async () => {
    api().get(`${PREFIX}/hiring/submissions/s9/detail/v1`).reply(404, { statusCode: 404, message: 'Submission not found' })

    const rows = await appTester(App.searches.find_result.operation.perform, bundle({ submission_id: 's9' }))

    expect(rows).toEqual([])
  })
})

describe('hydrators', () => {
  it('should explain a missing read_candidates scope instead of failing the Zap', async () => {
    api().get(`${PREFIX}/hiring/candidates/c1/v1`).reply(403, { statusCode: 403, message: 'API key missing required scope' })

    const candidate = await appTester(App.hydrators.getCandidate, bundle({ id: 'c1' }))

    expect(candidate).toEqual({ available: false, reason: 'The API key lacks the read_candidates scope.' })
  })

  it('should still ask Zapier to retry later on 429', async () => {
    api()
      .get(`${PREFIX}/hiring/submissions/s1/detail/v1`)
      .reply(429, { statusCode: 429, code: 'api_key_rate_limited', message: 'Wait 5 seconds' }, { 'Retry-After': '5' })

    await expect(appTester(App.hydrators.getResult, bundle({ id: 's1' }))).rejects.toMatchObject({ name: 'ThrottledError' })
  })
})
